// motor_intencoes.ts
// Motor de reconhecimento de perguntas em linguagem natural para o GECOPE.
// Roda ANTES de qualquer chamada ao Gemini — cobre as perguntas mais comuns
// sem custo e sem chamada externa. Se nenhuma intenção bater, o chamador
// (a Edge Function) deve cair no fallback do Gemini.
//
// IMPORTANTE: todas as consultas aqui são fixas e escritas por um humano.
// Os únicos valores que vêm do texto do usuário (distrito, empresa) são
// aplicados via métodos parametrizados do supabase-js (.eq, .ilike),
// nunca concatenados em SQL cru — não há risco de injeção aqui.

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Valores de referência confirmados no banco (evita erro de string errada)
// ---------------------------------------------------------------------------
const STATUS_OBRA = {
  PARALISADA: "Paralisada",
  EM_EXECUCAO: "Em Execução",
  AGUARDANDO_OS: "Aguardando OS",
} as const;

const STATUS_PROCESSO_FORA_TRAMITACAO = ["APROVADO", "ARQUIVADO", "EXCLUÍDO"];

// F5: valores confirmados de tipo_aditivo (schema_dicionario.md) — usados por
// aditivos_por_tipo para reconhecer qual tipo foi mencionado na pergunta,
// via encontrarTipoAditivo() -> encontrarMencionado(), que reordena por
// tamanho a cada chamada — a ordem física desta lista não importa mais para
// a correção do casamento (era relevante antes da F5 rodada 2 delegar para
// encontrarMencionado; mantida em ordem de leitura só por clareza).
const TIPOS_ADITIVO = [
  "Valor, vigência e execução",
  "Alteração Contratual Diversa",
  "Vigência e execução",
  "Reajuste de Preço",
  "Sub-Rogação",
  "Vigência",
  "Execução",
  "Valor",
];

// ---------------------------------------------------------------------------
// Utilitários de extração de parâmetros
// ---------------------------------------------------------------------------

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Cache simples em memória dos valores distintos de distrito, contratada (empresa
 * executora) e contratante (secretaria/órgão), carregado uma vez por "cold start"
 * da função. Evita SELECT DISTINCT repetido a cada pergunta.
 *
 * Atenção: contratada != contratante. contratada é a construtora; contratante é
 * a secretaria/órgão público (SOP-CE, SEDUC, etc.) — nunca assumir que é fixo.
 */
let cacheValoresConhecidos: { distritos: string[]; contratadas: string[]; contratantes: string[] } | null = null;

async function carregarValoresConhecidos(supabase: SupabaseClient) {
  if (cacheValoresConhecidos) return cacheValoresConhecidos;

  const [{ data: distritosData }, { data: contratadasData }, { data: contratantesData }] = await Promise.all([
    supabase.from("contratos_edificacao").select("distrito_operacional").not("distrito_operacional", "is", null),
    supabase.from("contratos_edificacao").select("contratada").not("contratada", "is", null),
    supabase.from("contratos_edificacao").select("contratante").not("contratante", "is", null),
  ]);

  const distritos = [...new Set((distritosData ?? []).map((r: any) => r.distrito_operacional))];
  const contratadas = [...new Set((contratadasData ?? []).map((r: any) => r.contratada))];
  const contratantes = [...new Set((contratantesData ?? []).map((r: any) => r.contratante))];

  cacheValoresConhecidos = { distritos, contratadas, contratantes };
  return cacheValoresConhecidos;
}

/**
 * Sufixos e palavras genéricas comuns em razões sociais/nomes formais que
 * atrapalham a correspondência por palavra-chave (ex: "Forteks Engenharia
 * Ltda" — o usuário normalmente só fala "Forteks").
 */
const PALAVRAS_GENERICAS_ENTIDADE = new Set([
  "ltda", "me", "eireli", "sa", "s/a", "epp",
  "construcoes", "construtora", "engenharia", "comercio", "servicos",
  "consorcio", "empreendimentos", "incorporadora", "empreiteira",
  "secretaria", "superintendencia", "gerencia", "departamento",
  "estado", "governo", "do", "da", "de", "e",
  // palavras conectoras que aparecem na PERGUNTA do usuário, não só em nomes
  // formais — sem isso, "da EMPRESA Consórcio X" casava com qualquer
  // pergunta que contivesse a palavra "empresa", independente do nome real
  "empresa", "contrato", "contratos", "obra", "obras", "grupo",
  "processo", "processos", "replanilhamento", "aditivo", "aditivos", "medicao", "medicoes",
]);

function extrairPalavrasChave(valor: string): string[] {
  return normalizar(valor)
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALAVRAS_GENERICAS_ENTIDADE.has(p)); // >=3: mantém siglas como "BWS"
}

/** Escapa caracteres especiais de regex — essencial ao montar um RegExp a
 * partir de texto dinâmico (nome de empresa), que pode conter parênteses,
 * pontos, barras etc. Sem isso, nomes com esses caracteres podem gerar
 * padrões inválidos ou casar de forma imprevisível. */
function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Encontra, dentro de uma lista de valores conhecidos (distritos, contratadas,
 * contratantes), qual foi mencionado na pergunta. Tenta primeiro uma
 * correspondência exata do valor completo (mais confiável), e se não achar,
 * cai para correspondência por palavra-chave significativa — assim
 * "Forteks" bate com "FORTEKS ENGENHARIA LTDA" no banco, sem precisar que o
 * usuário digite a razão social inteira.
 */
function encontrarMencionado(pergunta: string, valoresConhecidos: string[]): string | null {
  const perguntaNorm = normalizar(pergunta);
  const ordenados = [...valoresConhecidos].sort((a, b) => b.length - a.length);

  // 1. correspondência exata do valor completo
  for (const valor of ordenados) {
    if (perguntaNorm.includes(normalizar(valor))) return valor;
  }

  // 2. correspondência por palavra-chave significativa (fallback)
  for (const valor of ordenados) {
    const palavrasChave = extrairPalavrasChave(valor);
    if (palavrasChave.some((palavra) => new RegExp(`\\b${escaparRegex(palavra)}\\b`).test(perguntaNorm))) {
      return valor;
    }
  }

  return null;
}

/** F5: encontra qual tipo_aditivo (lista fixa, ver TIPOS_ADITIVO) foi
 * mencionado na pergunta. Reaproveita encontrarMencionado (mesmo sort
 * defensivo por tamanho a cada chamada, em vez de depender de TIPOS_ADITIVO
 * já vir perfeitamente ordenada à mão — achado do rev-aderencia). */
function encontrarTipoAditivo(pergunta: string): string | null {
  return encontrarMencionado(pergunta, TIPOS_ADITIVO);
}

/**
 * F5 rodada 3 (achado consolidado dos 4 revisores): nas duas rodadas
 * anteriores, cada bloqueio foi corrigido intenção por intenção (uma
 * chamada manual dentro de cada `executar`), e a cada rodada os revisores
 * achavam outra intenção com o mesmo problema que ninguém tinha lembrado de
 * instrumentar. Em vez de continuar assim: cada intenção agora DECLARA quais
 * qualificadores ela sabe de fato aplicar (`filtrosSuportados`, no objeto
 * Intencao), e uma checagem central em `tentarIntencao` cede automaticamente
 * (nem chega a chamar `executar`) sempre que a pergunta menciona um
 * qualificador fora dessa lista — em vez de depender de cada intenção
 * lembrar de se proteger sozinha. Fecha a classe inteira do problema de uma
 * vez, inclusive casos que nenhum revisor relatou ainda (ex.:
 * contratos_vigencia_status nunca soube filtrar por distrito).
 */
type TipoFiltro = "distrito" | "contratada" | "contratante" | "statusVigencia" | "valor";

interface FiltrosMencionados {
  distrito: string | null;
  contratada: string | null;
  contratante: string | null;
  /** "vencida" (vigência já vencida) ou "vigente" (contrato em vigor) — não
   * confundir com contratos_vencendo, que é sobre vencer no futuro próximo. */
  statusVigencia: "vencida" | "vigente" | null;
  /** true se a pergunta pede um valor em R$ (não uma contagem) — "valor
   * total", "valor de/dos/da/das X" ou "quanto custam/vale(m)/foi gasto".
   * Não dispara para a palavra "valor" isolada sem essas construções, porque
   * "valor" também aparece como nome de um tipo_aditivo (TIPOS_ADITIVO) e em
   * frases como "supressão de valor" — nenhuma das duas pede um total em R$.
   * Achado do rev-produto, repetido em 3 rodadas seguidas (F5, rodadas 3 e
   * 4): tentar reconhecer frases exatas ("valor total", "valor dos X",
   * "quanto custam") sempre deixava passar mais uma variação natural
   * ("quanto foi investido", "valor investido" — que nem exigia mudar de
   * verbo, só a preposição não bater com a lista). Trocado por: a palavra
   * "valor(es)" sozinha (com uma exceção só para as 2 colisões reais
   * conhecidas) + uma lista de verbos do campo semântico de "pedir dinheiro"
   * (custar, gastar, investir, valer, preço) — não depende mais de acertar
   * a preposição ou a ordem das palavras. */
  valor: boolean;
}

/** "valor"/"preço" nestes contextos NÃO pedem um total em R$: como nome de
 * um tipo_aditivo — "Valor" e "Reajuste de Preço" são 2 dos 8 valores fixos
 * de TIPOS_ADITIVO ("...do tipo Valor", "aditivos do tipo Reajuste de
 * Preço") — ou na frase "supressão de valor" (aditivos_com_supressao).
 * A checagem de tipo_aditivo exige a palavra "tipo" também presente (não só
 * "valor"/"preço" sozinhos) para não suprimir a detecção de valor em
 * perguntas legítimas de dinheiro que não têm nada a ver com tipo_aditivo
 * (ex.: "qual o valor total dos contratos?" não deve cair aqui). */
function mencionaValorComoTermoDeDominio(p: string): boolean {
  if (/supress[aã]o\s+de\s+valor/.test(p)) return true;
  return /\btipos?\b/.test(p) && /\b(valor|precos?)\b/.test(p);
}

/** Verbos/substantivos do campo semântico de "pedir um total em R$" além da
 * própria palavra "valor" — "cust*" (custa/custam/custou/custaram/custo),
 * "gast*" (gasto/gastos/gastou/gastaram), "investid*"/"investiment*"/
 * "investiu"/"investiram"/"investir" (não "investig*" — investigar não tem
 * nada a ver com dinheiro), "preç*", "montante", "soma", e as formas de
 * "valer". Achado do rev-correcao (F5, rodada 4): "montante"/"soma" também
 * escapavam. */
// testado contra o texto já normalizado (normalizar() remove acento E
// cedilha — "preço" vira "preco"), por isso "precos?" sem cedilha aqui. De
// propósito não aceita "prec" seguido de qualquer coisa (\w*), que pegaria
// "preciso"/"precisar"/"precisão" (nada a ver com dinheiro) — só o "o(s)"
// final de "preço(s)".
const PALAVRAS_PEDIDO_DE_VALOR =
  /\b(cust\w*|gast\w*|investid\w*|investiment\w*|investiu|investiram|investir|precos?|montantes?|somas?|vale|valem|valeu|valeram)\b/;

/** "o total de/dos/da/das X" (substantivo, pedindo A SOMA em R$) — não a
 * mesma coisa que "no total"/"ao todo" (advérbio, usado por várias intenções
 * de CONTAGEM já existentes: "quantos processos existem NO TOTAL?"). Exige
 * o artigo "o"/"os" logo antes de "total(is)" e uma preposição partitiva
 * logo depois, para não confundir as duas formas — achado do rev-correcao
 * (F5, rodada 4): "qual o total dos contratos no distrito de Crato?"
 * escapava do filtro de valor. */
const PEDE_O_TOTAL_EM_RS = /\bos?\s+tota(l|is)\s+d(e|os|as|o|a)\b/;

/** Achado consolidado de `rev-correcao`/`rev-produto` (F5, rodada 5, 4ª e 5ª
 * vez seguida bloqueando o mesmo detector de valor): uma lista de palavras
 * de "pede dinheiro" nunca converge — cada rodada achou mais uma leva nova e
 * coerente (frases exatas → verbos → total/montante/soma → vocabulário
 * orçamentário inteiro do serviço público: empenhado, despesa, recursos,
 * desembolso, quantia...). É a única checagem das 5 (`distrito`/
 * `contratada`/`contratante`/`statusVigencia`/`valor`) que depende de
 * enumerar vocabulário aberto em vez de um conjunto fechado.
 *
 * Correção estrutural: em vez de continuar tentando reconhecer TODA forma de
 * pedir dinheiro, as intenções que só sabem CONTAR (não somar em R$) passam
 * a exigir uma palavra interrogativa de contagem inequívoca — "quantos",
 * "quantas" ou "quais" — em vez de responder para qualquer frase que só
 * mencione o assunto (ex.: "contratos" + "distrito"). Note que é
 * "quantos/quantas" (PLURAL) e não "quanto/quanta" (singular) — em
 * português, o singular "quanto" é a forma de PERGUNTAR UM VALOR ("quanto
 * custa", "quanto foi gasto"), o oposto exato do que queremos exigir aqui.
 * Aplicada só às intenções cujo uso real no gabarito já inclui essa palavra
 * (não regride nenhum caso testado) — duas intenções ficaram de fora
 * (`contratos_vencendo`, `obras_prazo_execucao_encerrando`) porque o gabarito
 * as aciona sem "quantos/quantas/quais" (estilo tópico: "Contratos vencendo
 * no próximo mês"); essas continuam protegidas só pela lista de vocabulário. */
const TEM_MARCADOR_DE_CONTAGEM = /\b(quais|quantos|quantas)\b/i;

async function detectarFiltrosMencionados(supabase: SupabaseClient, pergunta: string): Promise<FiltrosMencionados> {
  const { distritos, contratadas, contratantes } = await carregarValoresConhecidos(supabase);
  const p = normalizar(pergunta);

  let statusVigencia: "vencida" | "vigente" | null = null;
  // achado do rev-seguranca (F5, rodada 3): só cobria a forma feminina
  // ("vencida") — "quantos contratos estão VENCIDOS?" (concordando com
  // "contratos", masculino) não era detectado.
  if (/\bvencidos?\b|\bvencidas?\b/.test(p)) statusVigencia = "vencida";
  else if (/\bvigentes?\b/.test(p)) statusVigencia = "vigente";

  const pedeValorMonetario =
    !mencionaValorComoTermoDeDominio(p) &&
    (/\bvalor(es)?\b/.test(p) || PALAVRAS_PEDIDO_DE_VALOR.test(p) || PEDE_O_TOTAL_EM_RS.test(p));

  return {
    distrito: encontrarMencionado(pergunta, distritos),
    contratada: encontrarMencionado(pergunta, contratadas),
    contratante: encontrarMencionado(pergunta, contratantes),
    statusVigencia,
    valor: pedeValorMonetario,
  };
}

/** Lista só os tipos de filtro que a pergunta de fato menciona (ignora os
 * campos vazios/nulos). Comparada contra intencao.filtrosSuportados em
 * tentarIntencao(). */
function tiposMencionados(filtros: FiltrosMencionados): TipoFiltro[] {
  const tipos: TipoFiltro[] = [];
  if (filtros.distrito) tipos.push("distrito");
  if (filtros.contratada) tipos.push("contratada");
  if (filtros.contratante) tipos.push("contratante");
  if (filtros.statusVigencia) tipos.push("statusVigencia");
  if (filtros.valor) tipos.push("valor");
  return tipos;
}

type Periodo = { inicio: string; fim: string; label: string };

function calcularPeriodo(chave: "este_mes" | "proximo_mes" | "este_ano"): Periodo {
  const hoje = new Date();
  if (chave === "este_ano") {
    return {
      inicio: `${hoje.getFullYear()}-01-01`,
      fim: `${hoje.getFullYear()}-12-31`,
      label: `este ano (${hoje.getFullYear()})`,
    };
  }
  const mesBase = chave === "proximo_mes" ? hoje.getMonth() + 1 : hoje.getMonth();
  const inicio = new Date(hoje.getFullYear(), mesBase, 1);
  const fim = new Date(hoje.getFullYear(), mesBase + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    inicio: fmt(inicio),
    fim: fmt(fim),
    label: chave === "proximo_mes" ? "no próximo mês" : "este mês",
  };
}

function detectarPeriodo(pergunta: string): Periodo | null {
  const p = normalizar(pergunta);
  if (p.includes("proximo mes")) return calcularPeriodo("proximo_mes");
  if (p.includes("este mes") || p.includes("esse mes")) return calcularPeriodo("este_mes");
  if (p.includes("este ano") || p.includes("esse ano")) return calcularPeriodo("este_ano");
  return null;
}

// ---------------------------------------------------------------------------
// Tipo de resultado de uma intenção
// ---------------------------------------------------------------------------
export interface DadosGrafico {
  tipo: "barra" | "linha";
  titulo: string;
  rotulos: string[];
  valores: number[];
}

export interface ResultadoIntencao {
  origem: "intencao";
  intencaoId: string;
  resposta: string;
  linhas: number;
  grafico?: DadosGrafico;
}

interface ContextoIntencao {
  supabase: SupabaseClient;
  pergunta: string;
}

interface Intencao {
  id: string;
  padroes: RegExp[];
  /** Quais qualificadores (ver TipoFiltro) esta intenção sabe de fato
   * aplicar no SQL que executa. tentarIntencao() cede automaticamente (nem
   * chama `executar`) se a pergunta mencionar um qualificador fora desta
   * lista, em vez de responder um recorte mais amplo que o pedido como se
   * fosse a resposta certa. Lista vazia = intenção "geral", sem nenhum
   * recorte aplicável — qualquer qualificador mencionado a faz ceder. */
  filtrosSuportados: TipoFiltro[];
  /** F5 rodada 5: true para intenções que só sabem CONTAR (nunca somar em
   * R$) e cujo gatilho, sozinho, é amplo demais (ex.: só "contratos" +
   * "distrito", sem exigir uma palavra de contagem) — exige também
   * TEM_MARCADOR_DE_CONTAGEM na pergunta, para não responder uma contagem
   * quando a pergunta pede um valor com um sinônimo ainda não catalogado em
   * PALAVRAS_PEDIDO_DE_VALOR. Opcional: omitido (`undefined`) equivale a
   * `false` — o gatilho já é específico o bastante ou não tem um valor
   * monetário plausível como interpretação alternativa. */
  exigeMarcadorDeContagem?: boolean;
  // Pode devolver null quando o padrão bateu mas os dados necessários (ex: nome
  // de empresa) não foram encontrados — nesse caso, tentarIntencao() segue
  // tentando outras intenções, e por fim cai no fallback do Gemini, em vez de
  // travar numa resposta de "não consegui identificar".
  executar: (ctx: ContextoIntencao) => Promise<ResultadoIntencao | null>;
}

// ---------------------------------------------------------------------------
// As intenções confirmadas
// ---------------------------------------------------------------------------

const intencoes: Intencao[] = [
  // 1. Quantos contratos estão paralisados?
  {
    id: "contratos_paralisados",
    padroes: [/contratos?\b.*paralisad/i, /obras?.*paralisad/i],
    filtrosSuportados: ["distrito"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { distritos } = await carregarValoresConhecidos(supabase);
      const distrito = encontrarMencionado(pergunta, distritos);

      let query = supabase
        .from("contratos_edificacao")
        .select("*", { count: "exact", head: true })
        .eq("status_obra", STATUS_OBRA.PARALISADA);
      if (distrito) query = query.eq("distrito_operacional", distrito);

      const { count } = await query;
      const sufixoDistrito = distrito ? ` no distrito de ${distrito}` : "";

      let grafico: DadosGrafico | undefined;
      if (!distrito) {
        const { data: porDistrito } = await supabase
          .from("contratos_edificacao")
          .select("distrito_operacional")
          .eq("status_obra", STATUS_OBRA.PARALISADA);
        const contagem: Record<string, number> = {};
        for (const r of porDistrito ?? []) {
          const chave = r.distrito_operacional ?? "Não informado";
          contagem[chave] = (contagem[chave] ?? 0) + 1;
        }
        const entradas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
        if (entradas.length > 1) {
          grafico = {
            tipo: "barra",
            titulo: "Contratos paralisados por distrito",
            rotulos: entradas.map(([d]) => d),
            valores: entradas.map(([, v]) => v),
          };
        }
      }

      return {
        origem: "intencao",
        intencaoId: "contratos_paralisados",
        resposta: `Existem ${count ?? 0} contratos paralisados${sufixoDistrito}.`,
        linhas: count ?? 0,
        grafico,
      };
    },
  },

  // 2. Quantos contratos vão vencer no próximo mês?
  {
    id: "contratos_vencendo",
    // cobre vencer, vencimento, vencem, vencendo — NÃO "vencido"/"vencida"
    // (negative lookahead): essas duas são status já ocorrido
    // (contratos_vigencia_status, F5), não "vai vencer em breve" (o que esta
    // intenção calcula, via data_fim_vigencia_contrato no próximo mês).
    // Achado do rev-aderencia (F5): sem o (?!id), "contratos com vigência
    // vencida" batia aqui primeiro (posição 2) e nunca alcançava
    // contratos_vigencia_status (posição 33) — os dois números às vezes
    // coincidem por acaso, mascarando o bug no eval.
    padroes: [/contratos?\b.*venc(?!id)/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const periodo = calcularPeriodo("proximo_mes");
      const { data, count } = await supabase
        .from("contratos_edificacao")
        .select("nr_contrato_sop, contratada, data_fim_vigencia_contrato", { count: "exact" })
        .gte("data_fim_vigencia_contrato", periodo.inicio)
        .lte("data_fim_vigencia_contrato", periodo.fim);

      const lista = (data ?? []).slice(0, 10)
        .map((r: any) => `• ${r.nr_contrato_sop} (${r.contratada})`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "contratos_vencendo",
        resposta: `${count ?? 0} contratos vencem ${periodo.label}.${lista ? "\n" + lista : ""}`,
        linhas: count ?? 0,
      };
    },
  },

  // 3. Quais obras estão com prazo de execução encerrando próximo mês?
  {
    id: "obras_prazo_execucao_encerrando",
    padroes: [/prazo.*execu[cç][aã]o.*(encerra|termina|acaba)/i, /obras?.*prazo.*pr[oó]ximo m[eê]s/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const periodo = calcularPeriodo("proximo_mes");
      const { data, count } = await supabase
        .from("contratos_edificacao")
        .select("codigo_obra, descricao_obra, contratada, data_fim_previsto", { count: "exact" })
        .gte("data_fim_previsto", periodo.inicio)
        .lte("data_fim_previsto", periodo.fim);

      const lista = (data ?? []).slice(0, 10)
        .map((r: any) => `• ${r.descricao_obra} (${r.contratada})`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "obras_prazo_execucao_encerrando",
        resposta: `${count ?? 0} obras têm o prazo de execução encerrando ${periodo.label}.${lista ? "\n" + lista : ""}`,
        linhas: count ?? 0,
      };
    },
  },

  // 4. Quais as obras/contratos da construtora/secretaria X?
  {
    id: "obras_por_contratada",
    padroes: [/(obras?|contratos?\b).*(empresa|construtora|contratada|secretaria|contratante)/i],
    filtrosSuportados: ["contratada", "contratante"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { contratadas, contratantes } = await carregarValoresConhecidos(supabase);
      // achado do rev-seguranca/rev-correcao (F5, rodada 3): antes, achar uma
      // contratada IMPEDIA de sequer procurar um contratante ("empresa ?
      // null : ...") — se a pergunta citava os dois ("Forteks com a SEDUC"),
      // o filtro de contratante era descartado em silêncio e a resposta
      // saía sem o segundo recorte. Agora os dois são buscados de forma
      // independente e aplicados juntos (AND) quando ambos aparecem.
      const empresa = encontrarMencionado(pergunta, contratadas);
      const contratante = encontrarMencionado(pergunta, contratantes);

      if (!empresa && !contratante) {
        return null; // deixa outra intenção ou o Gemini tentarem
      }

      let query = supabase
        .from("contratos_edificacao")
        .select("descricao_obra, status_obra, municipio", { count: "exact" });
      if (empresa) query = query.eq("contratada", empresa);
      if (contratante) query = query.eq("contratante", contratante);

      const { data, count } = await query;
      const lista = (data ?? [])
        .map((r: any) => `• ${r.descricao_obra} — ${r.municipio} (${r.status_obra})`)
        .join("\n");
      const nomeExibido = [empresa, contratante].filter(Boolean).join(" / ");
      return {
        origem: "intencao",
        intencaoId: "obras_por_contratada",
        resposta: `${nomeExibido} tem ${count ?? 0} obra(s):\n${lista}`,
        linhas: count ?? 0,
      };
    },
  },

  // 5. Quais contratos estão aguardando OS?
  {
    id: "contratos_aguardando_os",
    padroes: [/aguardando\s+os\b/i, /contratos?\b.*aguard.*\bos\b/i],
    filtrosSuportados: [],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase }) => {
      const { data, count } = await supabase
        .from("contratos_edificacao")
        .select("descricao_obra, contratada, municipio", { count: "exact" })
        .eq("status_obra", STATUS_OBRA.AGUARDANDO_OS);

      const lista = (data ?? []).slice(0, 10).map((r: any) => `• ${r.descricao_obra} (${r.contratada})`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "contratos_aguardando_os",
        resposta: `${count ?? 0} contratos estão aguardando OS.${lista ? "\n" + lista : ""}`,
        linhas: count ?? 0,
      };
    },
  },

  // 6. Quantos contratos no distrito operacional de X?
  {
    id: "contratos_por_distrito",
    // Achado do rev-correcao (F5): sem \b, "contratos?" casava como PREFIXO de
    // "contratou" ("Quantas obras a SOP CONTRATOU no distrito de Crato?"),
    // sequestrando essa pergunta de contratos_por_contratante (que trata o
    // distrito certo) — sempre um número maior/errado, sem aviso.
    padroes: [/contratos?\b.*distrito/i, /quantos?\s+contratos?\b.*em\s+[A-ZÀ-Ú]/],
    filtrosSuportados: ["distrito"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { distritos } = await carregarValoresConhecidos(supabase);
      const distrito = encontrarMencionado(pergunta, distritos);
      if (!distrito) {
        return null;
      }
      const { count } = await supabase
        .from("contratos_edificacao")
        .select("*", { count: "exact", head: true })
        .eq("distrito_operacional", distrito);

      return {
        origem: "intencao",
        intencaoId: "contratos_por_distrito",
        resposta: `O distrito operacional de ${distrito} tem ${count ?? 0} contratos.`,
        linhas: count ?? 0,
      };
    },
  },

  // 6b. Quantos contratos a SEDUC (ou outra secretaria/contratante) tem?
  {
    id: "contratos_por_contratante",
    padroes: [
      // achado do rev-aderencia/rev-produto (F5, rodada 2): sem \b,
      // "contratos" casava como PREFIXO de "contratou" — mesma classe de bug
      // já corrigida nas outras ~8 ocorrências do arquivo; faltavam estas 2.
      /quantos?\s+contratos?\b.*(seduc|sesa|secretaria|contratante)/i,
      /contratos?\b.*(da|de)\s+(secretaria|contratante)/i,
      // F5: "quantas obras a SOP contratou?" — mesma pergunta, sem a palavra
      // "contrato(s)". contratante ainda vem de carregarValoresConhecidos.
      /quantas?\s+obras?.*contratou/i,
    ],
    filtrosSuportados: ["contratante"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { contratantes } = await carregarValoresConhecidos(supabase);
      const contratante = encontrarMencionado(pergunta, contratantes);
      if (!contratante) {
        return null;
      }
      const { count } = await supabase
        .from("contratos_edificacao")
        .select("*", { count: "exact", head: true })
        .eq("contratante", contratante);

      return {
        origem: "intencao",
        intencaoId: "contratos_por_contratante",
        resposta: `A ${contratante} tem ${count ?? 0} contratos.`,
        linhas: count ?? 0,
      };
    },
  },


  {
    id: "fiscais_por_distrito",
    padroes: [/quantos?\s+fisca(l|is)/i],
    filtrosSuportados: ["distrito"],
    executar: async ({ supabase, pergunta }) => {
      const { distritos } = await carregarValoresConhecidos(supabase);
      const distrito = encontrarMencionado(pergunta, distritos);

      // comissao_fiscalizacao.id_obra -> contratos_edificacao.id_obra
      let query = supabase
        .from("comissao_fiscalizacao")
        .select("matricula, contratos_edificacao!inner(distrito_operacional)", { count: "exact" })
        .eq("tipo", "Fiscal");
      if (distrito) query = query.eq("contratos_edificacao.distrito_operacional", distrito);

      const { data, count } = await query;
      const matriculasUnicas = new Set((data ?? []).map((r: any) => r.matricula)).size;
      const sufixoDistrito = distrito ? ` em ${distrito}` : "";
      return {
        origem: "intencao",
        intencaoId: "fiscais_por_distrito",
        resposta: `Existem ${matriculasUnicas || count || 0} fiscais atuando${sufixoDistrito}.`,
        linhas: count ?? 0,
      };
    },
  },

  // 8. Quantos processos de replanilhamento temos em tramitação?
  {
    id: "processos_em_tramitacao",
    padroes: [/processos?.*(tramita|andamento)/i, /processos?\s+de\s+replanilhamento/i],
    filtrosSuportados: ["contratada"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { contratadas } = await carregarValoresConhecidos(supabase);
      const empresa = encontrarMencionado(pergunta, contratadas);

      let query = supabase
        .from("processos")
        .select("*", { count: "exact", head: true })
        .not("status", "in", `(${STATUS_PROCESSO_FORA_TRAMITACAO.map((s) => `"${s}"`).join(",")})`);
      if (empresa) query = query.eq("contratada", empresa);

      const { count } = await query;
      const sufixoEmpresa = empresa ? ` da ${empresa}` : "";
      return {
        origem: "intencao",
        intencaoId: "processos_em_tramitacao",
        resposta: `Existem ${count ?? 0} processos de replanilhamento em tramitação${sufixoEmpresa}.`,
        linhas: count ?? 0,
      };
    },
  },

  // 9. Quantos processos de replanilhamento a empresa X tem? (total, sem filtro de status)
  {
    id: "processos_por_empresa",
    padroes: [/processos?.*(empresa|construtora|contratada)/i],
    filtrosSuportados: ["contratada"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { contratadas } = await carregarValoresConhecidos(supabase);
      const empresa = encontrarMencionado(pergunta, contratadas);
      if (!empresa) {
        return null;
      }
      const { count } = await supabase
        .from("processos")
        .select("*", { count: "exact", head: true })
        .eq("contratada", empresa);

      return {
        origem: "intencao",
        intencaoId: "processos_por_empresa",
        resposta: `A ${empresa} tem ${count ?? 0} processos de replanilhamento registrados.`,
        linhas: count ?? 0,
      };
    },
  },

  // 16. Valor total de aditivos aprovados este mês/ano, por tipo
  {
    id: "valor_aditivos_aprovados",
    padroes: [/valor.*total.*aditivos?.*aprovad/i, /quanto.*aditivos?.*aprovad/i],
    filtrosSuportados: ["valor"],
    executar: async ({ supabase, pergunta }) => {
      const periodo = detectarPeriodo(pergunta) ?? calcularPeriodo("este_mes");
      const { data } = await supabase
        .from("aditivos_contrato")
        .select("tipo_aditivo, valor_aprovado")
        .gte("data_assinatura", periodo.inicio)
        .lte("data_assinatura", periodo.fim);

      const porTipo: Record<string, number> = {};
      let total = 0;
      for (const r of data ?? []) {
        const v = Number(r.valor_aprovado ?? 0);
        total += v;
        porTipo[r.tipo_aditivo] = (porTipo[r.tipo_aditivo] ?? 0) + v;
      }
      const detalhe = Object.entries(porTipo)
        .sort((a, b) => b[1] - a[1])
        .map(([tipo, v]) => `• ${tipo}: R$ ${v.toLocaleString("pt-BR")}`)
        .join("\n");

      const entradasOrdenadas = Object.entries(porTipo).sort((a, b) => b[1] - a[1]);

      return {
        origem: "intencao",
        intencaoId: "valor_aditivos_aprovados",
        resposta: `O valor total de aditivos aprovados ${periodo.label} é de R$ ${total.toLocaleString("pt-BR")}.\nPor tipo:\n${detalhe}`,
        linhas: data?.length ?? 0,
        grafico: entradasOrdenadas.length > 1
          ? {
              tipo: "barra",
              titulo: `Aditivos aprovados por tipo — ${periodo.label}`,
              rotulos: entradasOrdenadas.map(([tipo]) => tipo),
              valores: entradasOrdenadas.map(([, v]) => v),
            }
          : undefined,
      };
    },
  },

  // 17. Qual contrato teve o maior número de aditivos já registrados?
  {
    id: "contrato_mais_aditivos",
    padroes: [/contrato.*mais\s+aditivos/i, /maior\s+n[uú]mero\s+de\s+aditivos/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase.from("aditivos_contrato").select("id_contrato");
      const contagem: Record<number, number> = {};
      for (const r of data ?? []) contagem[r.id_contrato] = (contagem[r.id_contrato] ?? 0) + 1;
      const [idContratoTop, qtd] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      if (!idContratoTop) {
        return { origem: "intencao", intencaoId: "contrato_mais_aditivos", resposta: "Nenhum aditivo encontrado.", linhas: 0 };
      }
      const { data: contrato } = await supabase
        .from("contratos_edificacao")
        .select("descricao_obra, contratada, nr_contrato_sop")
        .eq("id_contrato", Number(idContratoTop))
        .maybeSingle();

      return {
        origem: "intencao",
        intencaoId: "contrato_mais_aditivos",
        resposta: `O contrato com mais aditivos é ${contrato?.nr_contrato_sop ?? idContratoTop} (${contrato?.descricao_obra ?? ""}, ${contrato?.contratada ?? ""}), com ${qtd} aditivos.`,
        linhas: 1,
      };
    },
  },

  // 18. Quantos aditivos tiveram supressão de valor?
  {
    id: "aditivos_com_supressao",
    padroes: [/aditivos?.*supress/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { count } = await supabase
        .from("aditivos_contrato")
        .select("*", { count: "exact", head: true })
        .gt("valor_supressao", 0);
      return {
        origem: "intencao",
        intencaoId: "aditivos_com_supressao",
        resposta: `${count ?? 0} aditivos tiveram supressão de valor.`,
        linhas: count ?? 0,
      };
    },
  },

  // 19. Tempo médio entre protocolo e assinatura de um aditivo
  {
    id: "tempo_medio_protocolo_assinatura",
    padroes: [/tempo\s+m[eé]dio.*protocolo.*assinatura/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase
        .from("aditivos_contrato")
        .select("data_protocolo, data_assinatura")
        .not("data_protocolo", "is", null)
        .not("data_assinatura", "is", null);

      const dias = (data ?? [])
        .map((r: any) => (new Date(r.data_assinatura).getTime() - new Date(r.data_protocolo).getTime()) / 86400000)
        .filter((d: number) => d >= 0);
      const media = dias.length ? dias.reduce((a: number, b: number) => a + b, 0) / dias.length : 0;

      return {
        origem: "intencao",
        intencaoId: "tempo_medio_protocolo_assinatura",
        resposta: `O tempo médio entre protocolo e assinatura de um aditivo é de ${media.toFixed(1)} dias.`,
        linhas: dias.length,
      };
    },
  },

  // 20. Aditivo de maior valor de repercussão
  {
    id: "aditivo_maior_repercussao",
    padroes: [/aditivo.*maior.*repercuss/i],
    filtrosSuportados: ["valor"],
    executar: async ({ supabase }) => {
      const { data } = await supabase
        .from("aditivos_contrato")
        .select("nr_aditivo, valor_repercussao, id_contrato")
        .order("valor_repercussao", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) {
        return { origem: "intencao", intencaoId: "aditivo_maior_repercussao", resposta: "Nenhum aditivo encontrado.", linhas: 0 };
      }
      const { data: contrato } = await supabase
        .from("contratos_edificacao")
        .select("descricao_obra, contratada")
        .eq("id_contrato", data.id_contrato)
        .maybeSingle();
      return {
        origem: "intencao",
        intencaoId: "aditivo_maior_repercussao",
        resposta: `O aditivo de maior repercussão é o ${data.nr_aditivo}, no valor de R$ ${Number(data.valor_repercussao).toLocaleString("pt-BR")}, do contrato ${contrato?.descricao_obra ?? ""} (${contrato?.contratada ?? ""}).`,
        linhas: 1,
      };
    },
  },

  // 21. Quantos aditivos foram publicados este mês?
  {
    id: "aditivos_publicados_periodo",
    padroes: [/aditivos?.*publicad/i],
    filtrosSuportados: [],
    executar: async ({ supabase, pergunta }) => {
      const periodo = detectarPeriodo(pergunta) ?? calcularPeriodo("este_mes");
      const { count } = await supabase
        .from("aditivos_contrato")
        .select("*", { count: "exact", head: true })
        .gte("data_publicacao", periodo.inicio)
        .lte("data_publicacao", periodo.fim);
      return {
        origem: "intencao",
        intencaoId: "aditivos_publicados_periodo",
        resposta: `${count ?? 0} aditivos foram publicados ${periodo.label}.`,
        linhas: count ?? 0,
      };
    },
  },

  // 22. Quais contratos com percentual de aditivo acima de 25%?
  {
    id: "contratos_percentual_aditivo_alto",
    padroes: [/percentual.*aditivo.*(acima|maior)/i, /contratos?\b.*25\s*%/],
    filtrosSuportados: [],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase }) => {
      const { data, count } = await supabase
        .from("ficha_contrato")
        .select("nr_contrato_sop, contratada_razao_social, percentual_aditivo", { count: "exact" })
        .gt("percentual_aditivo", 25)
        .order("percentual_aditivo", { ascending: false });

      const lista = (data ?? []).slice(0, 10)
        .map((r: any) => `• ${r.nr_contrato_sop} (${r.contratada_razao_social}) — ${r.percentual_aditivo?.toFixed(1)}%`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "contratos_percentual_aditivo_alto",
        resposta: `${count ?? 0} contratos estão com percentual de aditivo acima de 25%.${lista ? "\n" + lista : ""}`,
        linhas: count ?? 0,
      };
    },
  },

  // 23. Quais contratos têm o menor saldo restante?
  {
    id: "contratos_menor_saldo",
    padroes: [/menor\s+saldo/i, /saldo.*contrato.*(baixo|menor)/i],
    filtrosSuportados: ["valor"],
    executar: async ({ supabase }) => {
      const { data } = await supabase
        .from("ficha_contrato")
        .select("nr_contrato_sop, contratada_razao_social, saldo_contrato")
        .order("saldo_contrato", { ascending: true })
        .limit(10);

      const lista = (data ?? [])
        .map((r: any) => `• ${r.nr_contrato_sop} (${r.contratada_razao_social}): R$ ${Number(r.saldo_contrato).toLocaleString("pt-BR")}`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "contratos_menor_saldo",
        resposta: `Os 10 contratos com menor saldo restante:\n${lista}`,
        linhas: data?.length ?? 0,
      };
    },
  },

  // 24. Qual gestor tem mais contratos?
  {
    id: "gestor_mais_contratos",
    padroes: [/gestor.*mais\s+contratos/i, /qual\s+gestor.*mais/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase.from("ficha_contrato").select("gestor_nome");
      const contagem: Record<string, number> = {};
      for (const r of data ?? []) {
        if (!r.gestor_nome) continue;
        contagem[r.gestor_nome] = (contagem[r.gestor_nome] ?? 0) + 1;
      }
      const [nome, qtd] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      return {
        origem: "intencao",
        intencaoId: "gestor_mais_contratos",
        resposta: nome ? `O gestor com mais contratos é ${nome}, com ${qtd} contratos.` : "Nenhum gestor encontrado.",
        linhas: 1,
      };
    },
  },

  // 25. Qual contrato tem o maior percentual já medido?
  {
    id: "contrato_maior_percentual_medido",
    padroes: [/maior\s+percentual.*medid/i, /contrato.*mais\s+medido/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase
        .from("ficha_contrato")
        .select("nr_contrato_sop, contratada_razao_social, percentual_total_medido")
        .order("percentual_total_medido", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        origem: "intencao",
        intencaoId: "contrato_maior_percentual_medido",
        resposta: data
          ? `O contrato ${data.nr_contrato_sop} (${data.contratada_razao_social}) tem o maior percentual medido: ${data.percentual_total_medido?.toFixed(1)}%.`
          : "Nenhum contrato encontrado.",
        linhas: data ? 1 : 0,
      };
    },
  },

  // ---------------------------------------------------------------------
  // F5 — primeira leva de expansão (~20 → ~34 intenções). Perguntas óbvias
  // do domínio que hoje caem no caminho LLM (várias já tinham gabarito
  // conferido na F3, ver docs/assistente/eval/casos.jsonl) e duas novas
  // habilitadas pela F4 (vw_assistente_obra_completa): obras sem fiscal.
  // Sem log de uso real ainda (piloto = F8) — guiado por conhecimento de
  // domínio, não por análise de log. Registrado em fase-5-intencoes.md.
  // ---------------------------------------------------------------------

  // 26. Quantas obras estão em execução? (aceita filtro de distrito, mesma
  // lógica de contratos_paralisados — achado do rev-produto: sem isso, uma
  // pergunta "...em execução no distrito de Crato?" batia no regex e
  // devolvia o total NACIONAL como se fosse o recorte, silenciosamente.
  // filtrosSuportados não inclui contratada/contratante — achado do
  // rev-seguranca, rodada 2: "quantas obras a Forteks tem em execução?"
  // ainda respondia o total nacional; a checagem central agora cede.)
  {
    id: "total_obras_execucao",
    padroes: [/obras?.*em\s+execu[cç][aã]o/i],
    filtrosSuportados: ["distrito"],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const { distritos } = await carregarValoresConhecidos(supabase);
      const distrito = encontrarMencionado(pergunta, distritos);

      let query = supabase
        .from("contratos_edificacao")
        .select("*", { count: "exact", head: true })
        .eq("status_obra", STATUS_OBRA.EM_EXECUCAO);
      if (distrito) query = query.eq("distrito_operacional", distrito);

      const { count } = await query;
      const sufixoDistrito = distrito ? ` no distrito de ${distrito}` : "";
      return {
        origem: "intencao",
        intencaoId: "total_obras_execucao",
        resposta: `Existem ${count ?? 0} obras em execução${sufixoDistrito}.`,
        linhas: count ?? 0,
      };
    },
  },

  // 27. Quantos processos existem no total? (distinto de "em tramitação").
  {
    id: "total_processos_geral",
    padroes: [/quantos?\s+processos?\s+(existem|h[aá])\b/i, /processos?.*(no total|ao todo)\b/i],
    filtrosSuportados: [],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase }) => {
      const { count } = await supabase.from("processos").select("*", { count: "exact", head: true });
      return {
        origem: "intencao",
        intencaoId: "total_processos_geral",
        resposta: `Existem ${count ?? 0} processos no total.`,
        linhas: count ?? 0,
      };
    },
  },

  // 28. Quantos aditivos existem no total? (distinto de supressão/publicados/por tipo)
  {
    id: "total_aditivos_geral",
    padroes: [/quantos?\s+aditivos?\s+(existem|h[aá])\b/i, /aditivos?.*(no total|ao todo)\b/i],
    filtrosSuportados: [],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase }) => {
      const { count } = await supabase.from("aditivos_contrato").select("*", { count: "exact", head: true });
      return {
        origem: "intencao",
        intencaoId: "total_aditivos_geral",
        resposta: `Existem ${count ?? 0} aditivos no total.`,
        linhas: count ?? 0,
      };
    },
  },

  // 29. Quais os tipos de aditivo e quantos de cada? (resumo — checar ANTES
  // de aditivos_por_tipo: as duas compartilham a palavra "tipo").
  {
    id: "tipos_aditivo_resumo",
    padroes: [/(tipos?\s+de\s+aditivo|aditivos?.*tipo).*(quantos?\s+de\s+cada|e\s+quantos)/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase.from("aditivos_contrato").select("tipo_aditivo");
      const contagem: Record<string, number> = {};
      for (const r of data ?? []) contagem[r.tipo_aditivo] = (contagem[r.tipo_aditivo] ?? 0) + 1;
      const entradas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
      const detalhe = entradas.map(([tipo, n]) => `• ${tipo}: ${n}`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "tipos_aditivo_resumo",
        resposta: `Tipos de aditivo:\n${detalhe}`,
        linhas: entradas.length,
        grafico: entradas.length > 1
          ? { tipo: "barra", titulo: "Aditivos por tipo", rotulos: entradas.map(([t]) => t), valores: entradas.map(([, n]) => n) }
          : undefined,
      };
    },
  },

  // 30. Quantos aditivos são do tipo X? / Quantos aditivos do tipo X existem?
  {
    id: "aditivos_por_tipo",
    padroes: [/aditivos?\s+(s[aã]o\s+)?do\s+tipo\s+/i, /tipo\s+de\s+aditivo\s+/i],
    filtrosSuportados: [],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase, pergunta }) => {
      const tipo = encontrarTipoAditivo(pergunta);
      if (!tipo) return null; // não reconheceu o tipo — deixa o Gemini tentar
      const { count } = await supabase
        .from("aditivos_contrato")
        .select("*", { count: "exact", head: true })
        .eq("tipo_aditivo", tipo);
      return {
        origem: "intencao",
        intencaoId: "aditivos_por_tipo",
        resposta: `${count ?? 0} aditivos são do tipo ${tipo}.`,
        linhas: count ?? 0,
      };
    },
  },

  // 31. Qual o município com mais contratos?
  {
    id: "municipio_mais_contratos",
    padroes: [/munic[ií]pio.*mais\s+contratos/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase.from("contratos_edificacao").select("municipio").not("municipio", "is", null);
      const contagem: Record<string, number> = {};
      for (const r of data ?? []) contagem[r.municipio] = (contagem[r.municipio] ?? 0) + 1;
      const [municipio, qtd] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      return {
        origem: "intencao",
        intencaoId: "municipio_mais_contratos",
        resposta: municipio ? `O município com mais contratos é ${municipio}, com ${qtd} contratos.` : "Nenhum município encontrado.",
        linhas: 1,
      };
    },
  },

  // 32. Quais/quantas obras não têm fiscal designado? (habilitado pela F4 —
  // mesmo anti-join que vw_assistente_obra_completa deixa em branco)
  {
    id: "obras_sem_fiscal",
    padroes: [/obras?.*sem\s+fiscal/i, /quantas?\s+obras?.*n[aã]o\s+t[eê]m?\s+fiscal/i],
    filtrosSuportados: [],
    exigeMarcadorDeContagem: true,
    executar: async ({ supabase }) => {
      const { data: comFiscal } = await supabase
        .from("comissao_fiscalizacao")
        .select("id_obra")
        .eq("tipo", "Fiscal");
      const idsComFiscal = new Set((comFiscal ?? []).map((r: any) => r.id_obra));
      const { data: obras } = await supabase
        .from("contratos_edificacao")
        .select("id_obra, descricao_obra, contratada");
      const semFiscal = (obras ?? []).filter((o: any) => !idsComFiscal.has(o.id_obra));
      const lista = semFiscal.slice(0, 10).map((o: any) => `• ${o.descricao_obra} (${o.contratada})`).join("\n");
      return {
        origem: "intencao",
        intencaoId: "obras_sem_fiscal",
        resposta: `${semFiscal.length} obras não têm fiscal designado.${lista ? "\n" + lista : ""}`,
        linhas: semFiscal.length,
      };
    },
  },

  // 33. Quantos contratos estão vigentes / com vigência vencida?
  {
    id: "contratos_vigencia_status",
    padroes: [/quantos?\s+contratos?\s+(est[aã]o\s+)?vigent(es)?\b/i, /quantos?\s+contratos?\b.*vig[eê]ncia\s+vencida/i],
    filtrosSuportados: ["statusVigencia"],
    executar: async ({ supabase, pergunta }) => {
      const vencidos = /vencid/i.test(pergunta);
      const status = vencidos ? "Vigência Vencida" : "Vigente";
      const { count } = await supabase
        .from("contratos_edificacao")
        .select("*", { count: "exact", head: true })
        .eq("status_contrato", status);
      return {
        origem: "intencao",
        intencaoId: "contratos_vigencia_status",
        resposta: vencidos
          ? `${count ?? 0} contratos estão com vigência vencida.`
          : `${count ?? 0} contratos estão vigentes.`,
        linhas: count ?? 0,
      };
    },
  },

  // 34. Quantos distritos operacionais diferentes existem?
  {
    id: "total_distritos",
    padroes: [/quantos?\s+distritos?\s+(operacionais?\s+)?(diferentes\s+)?(existem|h[aá])/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { distritos } = await carregarValoresConhecidos(supabase);
      return {
        origem: "intencao",
        intencaoId: "total_distritos",
        resposta: `Existem ${distritos.length} distritos operacionais diferentes.`,
        linhas: distritos.length,
      };
    },
  },

  // 35. Quantas empresas contratadas diferentes existem?
  {
    id: "total_contratadas",
    padroes: [/quantas?\s+empresas?\s+contratadas?\s+(diferentes\s+)?(existem|h[aá])/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { contratadas } = await carregarValoresConhecidos(supabase);
      return {
        origem: "intencao",
        intencaoId: "total_contratadas",
        resposta: `Existem ${contratadas.length} empresas contratadas diferentes.`,
        linhas: contratadas.length,
      };
    },
  },

  // 36. Quantas fichas de contrato existem?
  {
    id: "total_fichas_contrato",
    padroes: [/quantas?\s+fichas?\s+(de\s+contrato\s+)?(existem|h[aá])/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { count } = await supabase.from("ficha_contrato").select("*", { count: "exact", head: true });
      return {
        origem: "intencao",
        intencaoId: "total_fichas_contrato",
        resposta: `Existem ${count ?? 0} fichas de contrato.`,
        linhas: count ?? 0,
      };
    },
  },

  // 37. Quantas medições foram registradas no total?
  {
    id: "total_medicoes",
    padroes: [/quantas?\s+medi[cç][oõ]es?\s+(foram\s+registradas|existem|h[aá])/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { count } = await supabase.from("medicoes").select("*", { count: "exact", head: true });
      return {
        origem: "intencao",
        intencaoId: "total_medicoes",
        resposta: `Foram registradas ${count ?? 0} medições no total.`,
        linhas: count ?? 0,
      };
    },
  },

  // 38. Qual o valor total dos contratos?
  {
    id: "valor_total_contratos",
    padroes: [/valor\s+total\s+d(os|e)\s+contratos?\b/i],
    filtrosSuportados: ["valor"],
    executar: async ({ supabase }) => {
      const { data } = await supabase.from("contratos_edificacao").select("valor_atual");
      const total = (data ?? []).reduce((acc: number, r: any) => acc + Number(r.valor_atual ?? 0), 0);
      return {
        origem: "intencao",
        intencaoId: "valor_total_contratos",
        resposta: `O valor total dos contratos é de R$ ${total.toLocaleString("pt-BR")}.`,
        linhas: data?.length ?? 0,
      };
    },
  },

  // 39. Qual distrito tem mais contratos?
  {
    id: "distrito_mais_contratos",
    // filtrosSuportados vazio: qualquer qualificador conhecido mencionado
    // (inclusive um distrito específico, não só contratada/contratante) faz
    // a checagem central ceder — na prática isso raramente atrapalha, porque
    // a pergunta típica ("qual distrito tem mais contratos?") não cita um
    // distrito específico; citar uma contratada/contratante é o caso real
    // que isto pretende cobrir ("em quantos distritos a empresa X atua" é
    // uma pergunta diferente, que esta intenção não responde).
    padroes: [/qual\s+distrito.*mais\s+contratos/i, /distrito.*maior\s+n[uú]mero\s+de\s+contratos/i],
    filtrosSuportados: [],
    executar: async ({ supabase }) => {
      const { data } = await supabase.from("contratos_edificacao").select("distrito_operacional").not("distrito_operacional", "is", null);
      const contagem: Record<string, number> = {};
      for (const r of data ?? []) contagem[r.distrito_operacional] = (contagem[r.distrito_operacional] ?? 0) + 1;
      const [distrito, qtd] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
      return {
        origem: "intencao",
        intencaoId: "distrito_mais_contratos",
        resposta: distrito ? `O distrito com mais contratos é ${distrito}, com ${qtd} contratos.` : "Nenhum distrito encontrado.",
        linhas: 1,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Função principal: tenta encontrar e executar uma intenção
// ---------------------------------------------------------------------------
export async function tentarIntencao(
  supabase: SupabaseClient,
  pergunta: string
): Promise<ResultadoIntencao | null> {
  const filtros = await detectarFiltrosMencionados(supabase, pergunta);
  const mencionados = tiposMencionados(filtros);

  for (const intencao of intencoes) {
    if (!intencao.padroes.some((regex) => regex.test(pergunta))) continue;

    // Checagem central (F5 rodada 3): se a pergunta menciona um qualificador
    // que esta intenção não declarou saber aplicar, nem chama executar() —
    // segue tentando outras intenções (uma mais específica pode dar conta) e,
    // por fim, cai no caminho LLM, que tenta o filtro de verdade.
    const filtroNaoSuportado = mencionados.some((tipo) => !intencao.filtrosSuportados.includes(tipo));
    if (filtroNaoSuportado) continue;

    // F5 rodada 5: para intenções só-contagem com gatilho amplo, exige uma
    // palavra de contagem inequívoca — fecha a classe de "pede valor com um
    // sinônimo não catalogado" sem depender de listar cada sinônimo.
    if (intencao.exigeMarcadorDeContagem && !TEM_MARCADOR_DE_CONTAGEM.test(pergunta)) continue;

    const resultado = await intencao.executar({ supabase, pergunta });
    if (resultado !== null) return resultado;
    // resultado null: essa intenção "quase" bateu mas faltou dado essencial
    // (ex: nome de empresa não encontrado) — continua tentando outras.
  }
  return null;
}
