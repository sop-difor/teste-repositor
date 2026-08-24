#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sigsop_contratos.py
Extracao de EDIFICACAO do portal da SOP-CE (ficha da obra + ficha do contrato).

Gera QUATRO conjuntos:
  contratos_edificacao   : ficha da obra, escalares (1 linha por obra)
  comissao_fiscalizacao  : fiscais/suplentes (1 linha por membro, FK id_obra)
  ficha_contrato         : ficha do contrato, escalares (1 linha por nr_contrato_sop)
  aditivos_contrato      : aditivos (1 linha por aditivo, FK id_contrato)

Back-ends (confirmados na aba Rede):
  LISTA    (POST): https://orcamentos-be.sop.ce.gov.br/orcamentos/api/gestao/consulta/orcamentos
  OBRA     (GET) : https://medicoes-be.sop.ce.gov.br/medicoes/api/edificacao/ficha/obra?codigoObra=XXX
  CONTRATO (GET) : https://medicoes-be.sop.ce.gov.br/medicoes/api/edificacao/ficha/contrato?nrContrato=YYY
  AUTH           : Authorization: Bearer <token>

Nao extrai trechos/medicoes/historico/despesas.

Uso:
    python sigsop_contratos.py --uma 05872025SEDUC01          # ficha da obra (teste)
    python sigsop_contratos.py --uma-contrato 06102025SEDUC   # ficha do contrato (teste)
    python sigsop_contratos.py --csv                          # gera os 4 CSVs
    python sigsop_contratos.py --supabase                     # upsert nas 4 tabelas
"""

import os
import sys
import csv
import json
import argparse
import unicodedata
import requests

# ---------------------------------------------------------------------------
# Configuracao — SOP
# ---------------------------------------------------------------------------

HOST_LISTA = "https://orcamentos-be.sop.ce.gov.br"
ENDPOINT_LISTA = "/orcamentos/api/gestao/consulta/orcamentos"  # POST

HOST_DETALHE = "https://medicoes-be.sop.ce.gov.br"
DETALHE_TPL = "/medicoes/api/{tipo}/ficha/obra"       # ?codigoObra=...
CONTRATO_TPL = "/medicoes/api/{tipo}/ficha/contrato"  # ?nrContrato=...

AUTH_PREFIX = "Bearer "
TOKEN_FILE = "token_sigsop.txt"
TOKEN_ENV = "SIGSOP_TOKEN"

SOMENTE_EDIFICACAO = True
ID_TIPO_EDIFICACAO = 6
TIPO_PATH_EDIFICACAO = "edificacao"
PAGE_SIZE = 100

# Manter apenas obras com estes status_obra (a comparacao ignora acento/caixa/espaco).
# 'Paralisadas' incluido como sinonimo de 'Paralisada' por seguranca.
STATUS_OBRA_MANTER = ["Em Execução", "Aguardando OS", "Paralisada", "Paralisadas"]

# ---------------------------------------------------------------------------
# Configuracao — Supabase
# ---------------------------------------------------------------------------

SUPABASE_URL = "https://qexdnxqmiaarzwwwrcor.supabase.co"
SUPABASE_KEY_FILE = "supabase_key.txt"
SUPABASE_KEY_ENV = "SUPABASE_KEY"
SUPABASE_LOTE = 500

TAB_CONTRATOS = "contratos_edificacao"
TAB_COMISSAO = "comissao_fiscalizacao"
TAB_FICHA = "ficha_contrato"
TAB_ADITIVOS = "aditivos_contrato"
TAB_MEDICOES = "medicoes"
CONFLICT_CONTRATOS = "codigo_obra"
CONFLICT_COMISSAO = "id"
CONFLICT_FICHA = "nr_contrato_sop"
CONFLICT_ADITIVOS = "id"
CONFLICT_MEDICOES = "id_medicao"

# ---------------------------------------------------------------------------
# Mapas JSON (camelCase) -> coluna (snake_case)
# ---------------------------------------------------------------------------

# ---- Ficha da obra (tabela principal) ----
MAPA = {
    "idObra": "id_obra",
    "codigoObra": "codigo_obra",
    "nrContratoSop": "nr_contrato_sop",
    "nrContratoExt": "nr_contrato_ext",
    "nrContratoSic": "nr_contrato_sic",
    "nrOs": "nr_os",
    "descricaoObra": "descricao_obra",
    "descricaoTipoContrato": "descricao_tipo_contrato",
    "contratada": "contratada",
    "cnpjContratada": "cnpj_contratada",
    "contratante": "contratante",
    "cnpjContratante": "cnpj_contratante",
    "municipio": "municipio",
    "distritoOperacional": "distrito_operacional",
    "statusObra": "status_obra",
    "statusContrato": "status_contrato",
    "fonteRecurso": "fonte_recurso",
    "nrFonteRecurso": "nr_fonte_recurso",
    "valorOriginal": "valor_original",
    "totalAditivo": "total_aditivo",
    "totalReajuste": "total_reajuste",
    "totalRealinhado": "total_realinhado",
    "valorPi": "valor_pi",
    "valorAtual": "valor_atual",
    "valorAtualContrato": "valor_atual_contrato",
    "prazoExecucao": "prazo_execucao",
    "prazoVigenciaContrato": "prazo_vigencia_contrato",
    "diasAditivado": "dias_aditivado",
    "diasParalisado": "dias_paralisado",
    "dataProposta": "data_proposta",
    "dataAssinatura": "data_assinatura",
    "dataInicioReal": "data_inicio_real",
    "dataFimPrevisto": "data_fim_previsto",
    "dataFimVigenciaContrato": "data_fim_vigencia_contrato",
}
COLUNAS = list(MAPA.values())

# ---- Comissao de fiscalizacao ----
COMISSAO_MAPA = {
    "id": "id", "idObra": "id_obra", "tipo": "tipo",
    "matricula": "matricula", "nomeReferencia": "nome_referencia",
}
NOME_COMPLETO_CANDIDATOS = ["nomeCompleto", "nome", "nomeFiscal",
                            "nomeCompletoFiscal", "nomePessoa", "nomeServidor"]
COMISSAO_COLUNAS = ["id", "id_obra", "codigo_obra", "tipo",
                    "matricula", "nome_completo", "nome_referencia"]

# ---- Ficha do contrato ----
# Obs.: a chave do numero do contrato e' 'nrContratoDer' (= nrContratoSop).
FICHA_MAPA = {
    "id": "id_contrato",
    "nrContratoDer": "nr_contrato_sop",
    "tipoContrato": "tipo_contrato",
    "statusContrato": "status_contrato",
    "gestorMatricula": "gestor_matricula",
    "gestorNome": "gestor_nome",
    "contratadaNomeFantasia": "contratada_nome_fantasia",
    "contratanteNomeFantasia": "contratante_nome_fantasia",
    "nrContratoCliente": "nr_contrato_cliente",
    "nrContratoSic": "nr_contrato_sic",
    "contratadaCnpj": "contratada_cnpj",
    "contratanteCnpj": "contratante_cnpj",
    "objetoContrato": "objeto_contrato",
    "contratadaRazaoSocial": "contratada_razao_social",
    "contratanteRazaoSocial": "contratante_razao_social",
    "nrLicitacao": "nr_licitacao",
    "valorOriginal": "valor_original",
    "totalAditivo": "total_aditivo",
    "totalRealinhado": "total_realinhado",
    "valorAtual": "valor_atual",
    "totalSupressao": "total_supressao",
    "percentualAditivo": "percentual_aditivo",
    "totalAditivoBruto": "total_aditivo_bruto",
    "totalMedido": "total_medido",
    "saldoContrato": "saldo_contrato",
    "percentualTotalMedido": "percentual_total_medido",
    "diasAVencer": "dias_a_vencer",
    "dataAssinatura": "data_assinatura",
    "dataProposta": "data_proposta",
    "dataPublicacao": "data_publicacao",
    "dataFimVigencia": "data_fim_vigencia",
    "dataFimExecucao": "data_fim_execucao",
    "dataInicioReal": "data_inicio_real",
}
FICHA_COLUNAS = list(FICHA_MAPA.values())

# ---- Aditivos (a API traz 'obvervacao' com typo; gravamos como observacao) ----
ADITIVO_MAPA = {
    "id": "id",
    "idContrato": "id_contrato",
    "nrAditivo": "nr_aditivo",
    "tipoAditivo": "tipo_aditivo",
    "obvervacao": "observacao",
    "nrProtocolo": "nr_protocolo",
    "valorAprovado": "valor_aprovado",
    "valorRepercussao": "valor_repercussao",
    "valorSupressao": "valor_supressao",
    "execucaoAprovado": "execucao_aprovado",
    "prazoAprovado": "prazo_aprovado",
    "dataProtocolo": "data_protocolo",
    "dataAssinatura": "data_assinatura",
    "dataPublicacao": "data_publicacao",
}
ADITIVOS_COLUNAS = ["id", "id_contrato", "nr_contrato_sop", "nr_aditivo",
                    "tipo_aditivo", "observacao", "nr_protocolo",
                    "valor_aprovado", "valor_repercussao", "valor_supressao",
                    "execucao_aprovado", "prazo_aprovado",
                    "data_protocolo", "data_assinatura", "data_publicacao"]

# ---- Medicoes (aninhadas em trechos[].medicoes[] na ficha do contrato) ----
MEDICAO_MAPA = {
    "idMedicao": "id_medicao",
    "nrMedicao": "nr_medicao",
    "idObra": "id_obra",
    "codigoObra": "codigo_obra",
    "total": "total",
    "valorAtual": "valor_atual",
    "valorMedido": "valor_medido",
    "valorMedicao": "valor_medicao",
    "valorRefGlosa": "valor_ref_glosa",
    "glosaDiversa": "glosa_diversa",
    "totalAGlosar": "total_a_glosar",
    "periodo": "periodo",
    "nrProtocolo": "nr_protocolo",
    "descricaoStatusMedicao": "descricao_status_medicao",
    "siglaStatusMedicao": "sigla_status_medicao",
    "descricaoStatusProcesso": "descricao_status_processo",
    "siglaStatusProcesso": "sigla_status_processo",
    "medicaoAdministrativa": "medicao_administrativa",
}
MEDICAO_COLUNAS = list(MEDICAO_MAPA.values())


# ---------------------------------------------------------------------------
# Credenciais e sessao
# ---------------------------------------------------------------------------

def _ler_credencial(arquivo: str, env: str, descricao: str) -> str:
    if os.path.exists(arquivo):
        with open(arquivo, "r", encoding="utf-8") as f:
            v = f.read().strip()
            if v:
                return v
    v = os.environ.get(env, "").strip()
    if v:
        return v
    sys.exit(f"ERRO: {descricao} nao encontrado. Crie '{arquivo}' ou defina ${env}.")


def nova_sessao() -> requests.Session:
    token = _ler_credencial(TOKEN_FILE, TOKEN_ENV, "token do SOP").replace("Bearer ", "").strip()
    s = requests.Session()
    s.headers.update({
        "Authorization": f"{AUTH_PREFIX}{token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    })
    return s


# ---------------------------------------------------------------------------
# Lista (POST paginado) -> so Edificacao; coleta codigoObra + nrContratoSop
# ---------------------------------------------------------------------------

def corpo_lista(page: int, size: int) -> dict:
    return {
        "size": size, "page": page, "sortColumns": [],
        "filters": {"gestor": True, "codigoObra": "", "objeto": "",
                    "nrContratoSop": "", "nrContratoCliente": ""},
    }


def _post_lista(s: requests.Session, page: int, size: int) -> dict:
    r = s.post(f"{HOST_LISTA}{ENDPOINT_LISTA}", json=corpo_lista(page, size), timeout=60)
    if r.status_code == 401:
        sys.exit("ERRO 401: token expirado/invalido. Renove o token_sigsop.txt.")
    r.raise_for_status()
    return r.json()


def listar(s: requests.Session) -> list:
    """Retorna [{'codigo_obra','nr_contrato_sop'}] so de Edificacao."""
    linhas, page = [], 1
    while True:
        data = _post_lista(s, page, PAGE_SIZE)
        results = data.get("results", []) if isinstance(data, dict) else []
        if not results:
            break
        for it in results:
            if SOMENTE_EDIFICACAO and it.get("idTipoContrato") != ID_TIPO_EDIFICACAO:
                continue
            if it.get("codigoObra"):
                linhas.append({"codigo_obra": it["codigoObra"],
                               "nr_contrato_sop": it.get("nrContratoSop")})
        print(f"  lista pagina {page}: {len(results)} linhas (edificacao acumulada: {len(linhas)})")
        if len(results) < PAGE_SIZE:
            break
        page += 1
    return linhas


# ---------------------------------------------------------------------------
# Detalhe (GET)
# ---------------------------------------------------------------------------

def _get_ficha(s: requests.Session, tpl: str, param: str, valor: str) -> dict:
    url = f"{HOST_DETALHE}{tpl.format(tipo=TIPO_PATH_EDIFICACAO)}"
    r = s.get(url, params={param: valor}, timeout=30)
    if r.status_code == 401:
        sys.exit("ERRO 401: token expirado/invalido. Renove o token_sigsop.txt.")
    r.raise_for_status()
    return r.json()


def buscar_obra(s, codigo_obra):
    return _get_ficha(s, DETALHE_TPL, "codigoObra", codigo_obra)


def buscar_contrato(s, nr_contrato):
    return _get_ficha(s, CONTRATO_TPL, "nrContrato", nr_contrato)


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def parse_contrato(o: dict) -> dict:
    return {snake: o.get(cam) for cam, snake in MAPA.items()}


def _norm(s) -> str:
    """Normaliza texto p/ comparacao: sem acento, minusculo, espacos colapsados."""
    if not s:
        return ""
    t = unicodedata.normalize("NFKD", str(s))
    t = "".join(c for c in t if not unicodedata.combining(c))
    return " ".join(t.lower().split())


STATUS_MANTER_NORM = {_norm(x) for x in STATUS_OBRA_MANTER}


def status_obra_permitido(o: dict) -> bool:
    return _norm(o.get("statusObra")) in STATUS_MANTER_NORM


def _nome_completo(m: dict):
    for chave in NOME_COMPLETO_CANDIDATOS:
        if m.get(chave):
            return m[chave]
    return None


def parse_comissao(o: dict) -> list:
    cod = o.get("codigoObra")
    linhas = []
    for m in (o.get("comissaoFiscalizacao") or []):
        linha = {snake: m.get(cam) for cam, snake in COMISSAO_MAPA.items()}
        linha["nome_completo"] = _nome_completo(m)
        linha["codigo_obra"] = cod
        linhas.append(linha)
    return linhas


def parse_ficha_contrato(c: dict) -> dict:
    return {snake: c.get(cam) for cam, snake in FICHA_MAPA.items()}


def parse_aditivos(c: dict) -> list:
    nr = c.get("nrContratoDer")
    linhas = []
    for a in (c.get("aditivos") or []):
        linha = {snake: a.get(cam) for cam, snake in ADITIVO_MAPA.items()}
        linha["nr_contrato_sop"] = nr
        linhas.append(linha)
    return linhas


def parse_medicoes(c: dict) -> list:
    """Medicoes ficam em trechos[].medicoes[] (id_obra e codigo_obra ja vem em cada uma)."""
    linhas = []
    for t in (c.get("trechos") or []):
        for m in (t.get("medicoes") or []):
            linhas.append({snake: m.get(cam) for cam, snake in MEDICAO_MAPA.items()})
    return linhas


# ---------------------------------------------------------------------------
# Extracao completa
# ---------------------------------------------------------------------------

def extrair_tudo(s: requests.Session):
    itens = listar(s)
    print(f"Total de obras de edificacao na lista: {len(itens)}.")
    print(f"Mantendo apenas status_obra em: {STATUS_OBRA_MANTER}")

    # 1) Ficha da obra (por obra). Le todas p/ conhecer o status_obra,
    #    mas SO guarda as que estao nos status desejados.
    contratos, comissoes = [], []
    obras_mantidas = set()   # id_obra mantidos (p/ filtrar medicoes depois)
    nrs_mantidos = set()     # nr_contrato_sop dos contratos com obra mantida
    pulados = 0
    print("Buscando fichas de obra...")
    for i, it in enumerate(itens, 1):
        cod = it["codigo_obra"]
        try:
            o = buscar_obra(s, cod)
            if not status_obra_permitido(o):
                pulados += 1
                print(f"  [obra {i}/{len(itens)}] {cod} pulada (status: {o.get('statusObra')})")
                continue
            contratos.append(parse_contrato(o))
            comissoes.extend(parse_comissao(o))
            if o.get("idObra") is not None:
                obras_mantidas.add(o.get("idObra"))
            if o.get("nrContratoSop"):
                nrs_mantidos.add(o.get("nrContratoSop"))
            print(f"  [obra {i}/{len(itens)}] {cod} OK")
        except Exception as e:
            print(f"  [obra {i}/{len(itens)}] {cod} FALHOU: {e}")

    # 2) Ficha do contrato: apenas contratos que tem alguma obra mantida.
    #    Medicoes sao filtradas para as obras mantidas (um contrato pode
    #    ter obras em outros status, cujas medicoes nao queremos).
    nrs = sorted(nrs_mantidos)
    fichas, aditivos, medicoes = [], [], []
    print(f"Buscando fichas de contrato ({len(nrs)} contratos com obra mantida)...")
    for i, nr in enumerate(nrs, 1):
        try:
            c = buscar_contrato(s, nr)
            fichas.append(parse_ficha_contrato(c))
            aditivos.extend(parse_aditivos(c))
            medicoes.extend(m for m in parse_medicoes(c)
                            if m.get("id_obra") in obras_mantidas)
            print(f"  [contrato {i}/{len(nrs)}] {nr} OK")
        except Exception as e:
            print(f"  [contrato {i}/{len(nrs)}] {nr} FALHOU: {e}")

    print(f"Resumo: {len(contratos)} obras mantidas ({pulados} puladas), "
          f"{len(comissoes)} membros, {len(fichas)} contratos, "
          f"{len(aditivos)} aditivos, {len(medicoes)} medicoes.")
    return contratos, comissoes, fichas, aditivos, medicoes


# ---------------------------------------------------------------------------
# Saidas
# ---------------------------------------------------------------------------

def salvar_csv(linhas: list, colunas: list, caminho: str) -> None:
    if not linhas:
        print(f"  (vazio) nada gravado em {caminho}")
        return
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=colunas)
        w.writeheader()
        w.writerows(linhas)
    print(f"  OK: {len(linhas)} linhas em {caminho}")


def enviar_supabase(linhas: list, tabela: str, conflict: str, key: str) -> None:
    if not linhas:
        print(f"  (vazio) nada enviado para {tabela}")
        return
    url = f"{SUPABASE_URL}/rest/v1/{tabela}?on_conflict={conflict}"
    headers = {
        "apikey": key, "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    enviados = 0
    for i in range(0, len(linhas), SUPABASE_LOTE):
        lote = linhas[i:i + SUPABASE_LOTE]
        r = requests.post(url, headers=headers, json=lote, timeout=60)
        if not r.ok:
            sys.exit(f"ERRO Supabase {r.status_code} em {tabela}: {r.text[:500]}")
        enviados += len(lote)
        print(f"  {tabela}: {enviados}/{len(linhas)}")
    print(f"  OK: {enviados} linhas em public.{tabela}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Extrator de Edificacao (obra + contrato) - SOP")
    p.add_argument("--uma", metavar="CODIGO", help="Testa parser da ficha da obra")
    p.add_argument("--uma-contrato", metavar="NRCONTRATO", help="Testa parser da ficha do contrato")
    p.add_argument("--dump", nargs=2, metavar=("CODIGO", "ARQUIVO"), help="JSON completo de uma obra")
    p.add_argument("--dump-contrato", nargs=2, metavar=("NRCONTRATO", "ARQUIVO"),
                   help="JSON completo da ficha do contrato")
    p.add_argument("--csv", action="store_true", help="Gera os 4 CSVs")
    p.add_argument("--supabase", action="store_true", help="Upsert nas 4 tabelas")
    args = p.parse_args()

    s = nova_sessao()

    if args.dump:
        cod, caminho = args.dump
        with open(caminho, "w", encoding="utf-8") as f:
            json.dump(buscar_obra(s, cod), f, indent=2, ensure_ascii=False)
        print(f"Gravado em {caminho}")

    elif args.dump_contrato:
        nr, caminho = args.dump_contrato
        with open(caminho, "w", encoding="utf-8") as f:
            json.dump(buscar_contrato(s, nr), f, indent=2, ensure_ascii=False)
        print(f"Gravado em {caminho}")

    elif args.uma:
        o = buscar_obra(s, args.uma)
        print("--- ficha da obra (parseada) ---")
        print(json.dumps(parse_contrato(o), indent=2, ensure_ascii=False))
        print("--- comissao (parseada) ---")
        print(json.dumps(parse_comissao(o), indent=2, ensure_ascii=False))

    elif args.uma_contrato:
        c = buscar_contrato(s, args.uma_contrato)
        print("--- ficha do contrato (parseada) ---")
        print(json.dumps(parse_ficha_contrato(c), indent=2, ensure_ascii=False))
        print("--- aditivos (parseados) ---")
        print(json.dumps(parse_aditivos(c), indent=2, ensure_ascii=False))

    elif args.csv:
        contratos, comissoes, fichas, aditivos, medicoes = extrair_tudo(s)
        salvar_csv(contratos, COLUNAS, f"{TAB_CONTRATOS}.csv")
        salvar_csv(comissoes, COMISSAO_COLUNAS, f"{TAB_COMISSAO}.csv")
        salvar_csv(fichas, FICHA_COLUNAS, f"{TAB_FICHA}.csv")
        salvar_csv(aditivos, ADITIVOS_COLUNAS, f"{TAB_ADITIVOS}.csv")
        salvar_csv(medicoes, MEDICAO_COLUNAS, f"{TAB_MEDICOES}.csv")

    elif args.supabase:
        key = _ler_credencial(SUPABASE_KEY_FILE, SUPABASE_KEY_ENV, "service_role key do Supabase")
        contratos, comissoes, fichas, aditivos, medicoes = extrair_tudo(s)
        # ordem respeita as FKs: pais antes dos filhos
        enviar_supabase(contratos, TAB_CONTRATOS, CONFLICT_CONTRATOS, key)
        enviar_supabase(comissoes, TAB_COMISSAO, CONFLICT_COMISSAO, key)
        enviar_supabase(medicoes, TAB_MEDICOES, CONFLICT_MEDICOES, key)
        enviar_supabase(fichas, TAB_FICHA, CONFLICT_FICHA, key)
        enviar_supabase(aditivos, TAB_ADITIVOS, CONFLICT_ADITIVOS, key)

    else:
        p.print_help()


if __name__ == "__main__":
    main()
