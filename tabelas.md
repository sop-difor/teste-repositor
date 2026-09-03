# Reestruturação das tabelas SEINFRA / SINAPI / ORSE

> Registro vivo do projeto. Cada etapa tem: objetivo, ações, o que os revisores conferem,
> status e como reverter. **Nada destrutivo roda sem "ok" explícito do responsável.**

- **Responsável:** Nildeno (nildeno.aragao@gmail.com)
- **Projeto Supabase:** `qexdnxqmiaarzwwwrcor` (SOP.DIFOR, região sa-east-1, Postgres 17)
- **Restrição fixa:** tudo tem que caber no plano gratuito (500 MB).
- **Início:** 2026-09-01

---

## 1. Motivo

Hoje cada versão nova de tabela grava **tudo de novo**. Medições no banco (2026-09-01):

| Fonte | Linhas | Total | Tabela | Índices | Maior vilão |
|---|---:|---:|---:|---:|---|
| `sinapi_itens` | 263.586 | 260 MB | 188 MB | 63 MB | `composicao` jsonb = **139 MB**; `descricao` = 32 MB; índice trigram = 52 MB |
| `orse_itens` | 176.367 | 64 MB | 29 MB | 34 MB | índice trigram = 29 MB |
| `seinfra_itens` | 58.510 | 48 MB | 35 MB | 12 MB | `composicao` jsonb; índice trigram = 8 MB |
| **Soma** | | **372 MB** | | | |

Redundância medida:

- **Estrutura das composições: 85,3% é repetição pura entre meses.** 111.972 versões de
  composição gravadas na SINAPI → apenas **16.478 estruturas realmente distintas**.
- **Preços:** ~43% das linhas repetem o valor do mês anterior (dedup simples por valor:
  263.586 → 150.143).
- **Descrição:** 90% dos códigos nunca mudaram de descrição; ~1.500 mudaram em algum mês
  (no máximo 3 versões ao longo do tempo).
- **`onerada` vs `desonerada`:** SINAPI — estrutura da composição **idêntica** entre as duas
  (verificado 2026-09-01: 0 de 55.986 pares codigo+referência diferem; só o preço muda).
  SEINFRA — quase sempre idêntica, mas **3 de 8.850 pares diferem** (ex. `C3189`, `C3947`,
  `C3952` na referência `27`) → a composição da SEINFRA guarda a dimensão `tipo_encargo`.
- Dentro do jsonb, `descricao_item` (texto longo) é repetido em todo pai que usa aquele
  filho — e o filho já tem a descrição na própria linha. `preco_unitario` / `valor_total`
  dentro do jsonb são deriváveis (`coeficiente × preço`).

Sem bloat / dead tuples — é redundância real de dados, não lixo de vacuum.

## 2. Como o sistema usa essas tabelas hoje

- Acesso **100% leitura**, em 2 arquivos front-end:
  [gecope/modules/tabelas/tabelas.js](gecope/modules/tabelas/tabelas.js) e
  [gecope/modules/composicoes/composicoes.js](gecope/modules/composicoes/composicoes.js).
- **Nenhuma** migration, view, function, trigger ou rotina de ingestão no repositório. Os
  dados são carregados hoje por um programa local do responsável, que lê a planilha e
  insere no banco.
- Padrão de todas as consultas:
  `.from(tabela).select('*')` + `.eq('referencia', ...)` + `.eq('tipo_encargo', ...)` +
  `.or('codigo.ilike.%t%,descricao.ilike.%t%')` + `.limit(1000)` / `.single()`.
- O usuário **escolhe a referência histórica** num dropdown (montado a partir do
  min/max de `referencia` na tabela). Todo o histórico precisa continuar consultável.
- `tipo_encargo`: selecionável em SINAPI e SEINFRA; travado em `onerada` no ORSE.
  SEINFRA guarda hoje texto livre (`onerada`, `desonerada`, `não desonerada`).
- A composição (jsonb) é consumida no modal de detalhe e na impressão do módulo Tabelas.
  SINAPI **recalcula** `coeficiente × preço`; SEINFRA lê `valor_total` de dentro do jsonb
  (também recalculável). ORSE **não tem** composição (a receita é consultada por link
  externo) — e continuará sem.

## 3. Colunas reais hoje (o que a fachada precisa reproduzir)

| Coluna | sinapi_itens | orse_itens | seinfra_itens |
|---|---|---|---|
| `id` | bigint | bigint | bigint |
| `identificacao` | char(1) | char(1) | char(1) |
| `codigo` | varchar(20) | varchar(20) | varchar(20) |
| `descricao` | text | text | text |
| `unidade` | varchar(10) | varchar(10) | varchar(10) |
| `preco_unitario` | numeric | numeric | numeric |
| `tipo_encargo` | varchar(15) | varchar(15) | varchar(15) |
| `referencia` | **date** | **date** | **varchar(10)** |
| `created_at` | timestamptz | timestamptz | timestamptz |
| `composicao` | jsonb | — | jsonb |

`identificacao`: `C` = composição/serviço, `I` = insumo.
Formato dos elementos do `composicao` que o front-end lê:
- SINAPI: `{tipo_item, codigo_item, coeficiente, unidade, descricao_item, preco_unitario, valor_total}`
- SEINFRA: idem + `categoria` (`MÃO DE OBRA` / `MATERIAL` / `EQUIPAMENTO` / ...)

---

## 4. Formato novo (alvo)

Para **cada fonte**, blocos pequenos. Nomes provisórios — DDL exato sai na E1, com revisão.

### 4.1 Catálogo de itens — `sinapi_item`, `orse_item`, `seinfra_item`
Uma linha por código que já apareceu.
- `codigo` (PK)
- `identificacao` char(1)
- `categoria` text (só SEINFRA; null nas outras)

### 4.1b Presença por referência — `sinapi_item_presenca`, `orse_item_presenca`, `seinfra_item_presenca`
Resolve o ponto A (ver §10): itens **somem e voltam** entre referências (ORSE: 47% dos
códigos têm buraco; SINAPI: 17%; SEINFRA: 0). Uma linha por **intervalo contíguo** em que
o código aparece.
- `codigo` (FK do catálogo)
- `ref_ord_ini` int, `ref_ord_fim` int
- PK (`codigo`, `ref_ord_ini`)
- A fachada mostra o item na referência `R` se existir linha com
  `ref_ord_ini <= R.referencia_ord <= ref_ord_fim`.

### 4.2 Histórico de descrição — `sinapi_descricao`, `orse_descricao`, `seinfra_descricao`
Uma linha nova **só quando `descricao` ou `unidade` mudam**.
- `codigo` (FK do catálogo)
- `vigente_desde_ord` int — ordinal da referência a partir da qual passou a valer
- `descricao` text, `unidade` text
- PK (`codigo`, `vigente_desde_ord`)

### 4.3 Histórico de preço — `sinapi_preco`, `orse_preco`, `seinfra_preco`
Uma linha nova **só quando o preço muda**.
- `codigo` (FK)
- `tipo_encargo` text — normalizado para **`onerada` | `desonerada`** (ORSE: só `onerada`)
- `vigente_desde_ord` int
- `preco_unitario` numeric
- PK (`codigo`, `tipo_encargo`, `vigente_desde_ord`)

### 4.4 Estrutura da composição — `sinapi_composicao`, `seinfra_composicao` (ORSE não tem)
Conjunto de linhas com a mesma chave de versão = uma versão da receita. Versão nova **só
quando a assinatura estrutural muda** (ver §10-D para a definição exata da assinatura).
- `codigo` (FK — o serviço "pai")
- `tipo_encargo` text — **só na `seinfra_composicao`** (ver §1). Na `sinapi_composicao`
  não existe (estrutura verificada idêntica entre encargos).
- `vigente_desde_ord` int
- `ordem` smallint — preserva a ordem de exibição do arquivo de origem
- `codigo_item` text — o insumo/filho
- `tipo_item` text (`INSUMO` / `COMPOSICAO`)
- `categoria` text (só SEINFRA)
- `coeficiente` numeric — precisão normalizada antes de comparar/gravar (ver §10-D)
- PK SINAPI: (`codigo`, `vigente_desde_ord`, `ordem`)
- PK SEINFRA: (`codigo`, `tipo_encargo`, `vigente_desde_ord`, `ordem`)

> Sem `descricao_item`, sem `preco_unitario`, sem `valor_total`: descrição vem de §4.2,
> preço de §4.3. `valor_total` — ver §10-E (SEINFRA hoje lê do jsonb; decidir recalcular
> `round(coeficiente × preço, 2)` vs. guardar o valor da planilha).

### 4.5 Referências carregadas — `referencia_carregada` (comum às 3 fontes)
- `fonte` text (`SINAPI` | `ORSE` | `SEINFRA`)
- `referencia_label` text — valor que a fachada emite e pelo qual o front-end filtra.
  SINAPI/ORSE: `'2025-12-01'`; SEINFRA: `'28'`.
- `referencia_ord` int — inteiro monotônico para ordenar e resolver "o que valia em X".
  SINAPI/ORSE: `AAAAMM` (ex. 202512); SEINFRA: o número da tabela (27, 28, ...).
- `carregada_em` timestamptz
- PK (`fonte`, `referencia_ord`)

### 4.6 Fachadas — views `sinapi_itens`, `orse_itens`, `seinfra_itens`
Mesmos nomes, **exatamente as colunas e tipos da §3** — nada a mais (nem `categoria` no
topo da view SEINFRA; o front-end já cai no fallback `identificacao` hoje). Construção em
**duas camadas** (evita destruir os índices trigram na busca — ver §10-B):

1. **Camada plana** — view/junção só com colunas escalares, 1:1 de `*_item` +
   `*_item_presenca` + `*_descricao` (vigente) + `*_preco` (vigente, por `tipo_encargo`).
   O `ilike` em `codigo`/`descricao` do front-end alcança o índice trigram das tabelas
   base. **JOIN explícito com `*_item_presenca`**: o item só aparece na referência `R` se
   houver intervalo cobrindo `R` (sem isso, item vaza para meses em que não existia).
2. **Composição** — montada só para as linhas já filtradas/limitadas, como subconsulta
   escalar correlacionada na projeção externa, **ou** por função
   `montar_composicao(fonte, codigo, referencia, tipo_encargo) RETURNS jsonb` usada só no
   caminho do modal de detalhe. Nunca `GROUP BY ... jsonb_agg` sobre a referência inteira.

Regras:
- `referencia` na saída: **cast para o tipo de hoje** — `date` (SINAPI/ORSE),
  `varchar(10)` (SEINFRA).
- `id` = `hashtextextended(codigo || '|' || referencia_label || '|' || coalesce(tipo_encargo,''), 0)`
  (64 bits). Só precisa existir e ser estável — o front-end usa `.single()`, nunca ordena
  nem filtra por `id`. A segurança do `.single()` vem de a consulta devolver 1 linha, não
  do `id`.
- `created_at` = `carregada_em`.
- **`ORDER BY codigo`** (+ desempate) na view, para o resultado não "embaralhar" vs. hoje.
- **`WITH (security_invoker = true)`** + RLS/grants nas tabelas base copiados verbatim das
  `*_itens` de hoje (ver §10-F). Testar E5/E6 com a chave **anon**, não a de serviço.

### 4.7 Área de recebimento — `stg_sinapi`, `stg_orse`, `stg_seinfra`
Tabelas temporárias, **truncadas após cada carga**. Formato = a planilha achatada
(1 linha por item + N linhas por elemento de composição, ou coluna jsonb — decidir na E2
com base nos exemplos de planilha). Só existem para receber o CSV e servir de entrada ao
comando de comparação.

### 4.8 Estimativa de tamanho final
Entre **60 e 100 MB para as três** (contra 372 MB hoje). Confirmar na E7.

---

## 5. Fluxo de carga mensal (depois de pronto)

1. O programa local lê a planilha e **gera um CSV no formato da área de recebimento**.
2. O responsável sobe o CSV pela tela do Supabase (Table editor → Import) para `stg_<fonte>`.
3. O responsável roda **um comando** (`SELECT aplicar_<fonte>('<referencia>');`) que:
   - registra a referência em `referencia_carregada`;
   - insere no catálogo os itens novos;
   - insere em descrição/preço **só o que mudou** vs. a referência anterior;
   - insere uma versão nova de composição **só onde a estrutura mudou**;
   - trunca `stg_<fonte>`.
4. Confere na tela.

## 6. Migração do histórico já existente

Depois do backup (E0), reprocessar os meses já carregados **do mais antigo para o mais
novo**, alimentando o mesmo comando de comparação a partir dos dados que já estão no banco
(não é preciso as planilhas originais). Referências hoje:

- SINAPI: 11 referências (2025-01 … 2026-06)
- ORSE: 16 referências (2025-01 … 2026-05, com lacunas)
- SEINFRA: 2 referências (`27`, `28`)

## 7. Backup (fora do banco)

Um **CSV por tabela** (`sinapi_itens`, `orse_itens`, `seinfra_itens`), baixado e guardado
fora do Supabase (computador / Google Drive). Nada de backup dentro do banco. Serve para
resubir em caso de problema. Script e instruções na E0.

---

## 8. Protocolo dos agentes revisores

Depois de **cada** etapa que produz mudança, disparar 1+ agente revisor com a instrução de
procurar, naquela etapa especificamente:

1. **Bugs / correção** — o SQL faz o que a etapa promete? Casos de borda: item que some e
   volta (tem de **sumir** da fachada no intervalo do buraco); preço/descrição que oscila e
   volta ao valor anterior; primeira aparição do item (comparação contra NULL — usar
   `IS DISTINCT FROM`, nunca `<>`); composição vazia / só insumos; referência fora de ordem
   na carga; `codigo_item` órfão (§10-G).
2. **Consistência de dados** — contagens antes/depois batem? Ver §8.1 abaixo.
3. **Redundância** — sobrou repetição que dava para evitar? Índice inútil?
4. **Estabilidade / desempenho** — `EXPLAIN` do acesso de 1 linha (`.single()`) e da busca
   `ilike` + `limit(1000)` usa os índices trigram das tabelas base? A montagem do jsonb
   roda só para as linhas limitadas?
5. **Segurança de acesso** — testar com a chave **anon** (não a de serviço):
   `security_invoker=true` nas views + RLS/grants das tabelas base == os das `*_itens` de
   hoje (nem mais permissivo, nem quebrando o front-end). PostgREST enxerga a view.

### 8.1 Reconciliação exigida nas etapas de migração (E3/E4)
- **Pelo menos 1 referência inteira reconciliada a 100%**: para toda linha de
  `<fonte>_itens_old` naquela `referencia`, a fachada nova devolve, para a mesma
  (`codigo`, `referencia`, `tipo_encargo`): mesmo `descricao`, `unidade`, `preco_unitario`,
  `identificacao`, e mesmo conteúdo de `composicao` (mesmos `codigo_item`, `coeficiente`,
  `tipo_item`, ordem; `descricao_item`/`preco_unitario`/`valor_total` dentro do tolerável —
  ver §10-E). Zero linhas a mais, zero a menos.
- Amostragem só complementa; não substitui a reconciliação total de 1 referência.

Só avançar para a próxima etapa depois que a revisão passar. Registrar o resultado no §12.

---

## 9. Etapas

Legenda de status: ⬜ pendente · 🟡 em andamento · ✅ concluída · 🔴 bloqueada

### E0 — Backup 🟡 (CSVs gerados; falta o responsável copiar para fora do projeto)
- **Objetivo:** ter os 3 CSVs guardados fora do banco antes de qualquer mudança.
- **Ações:** rodar `E0_backup.mjs` (lê a string de conexão de `db-url.local`). Passo a
  passo em `README_E0.md`. *(scripts E0..E5f removidos da pasta em 2026-09-02 — já
  aplicados; ver migrations `e0`..`e6b` no Supabase e o histórico neste arquivo)*
- **Feito 2026-09-01:** `backup/sinapi_itens_2026-09-01.csv` (263.586), `orse_itens_...`
  (176.367), `seinfra_itens_...` (58.510). Auto-conferência de linhas: OK nas 3.
  Cabeçalhos batem com §3.
- **Pendente:** copiar a pasta `backup/` para fora do projeto (Drive/HD); apagar
  `db-url.local`.
- **Reverter:** n/a (não muda nada).
- **Entregue:** `E0_backup.mjs`, `package.json`, `README_E0.md` (2026-09-01).

### E1 — Criar tabelas novas vazias + área de recebimento ✅ (revisada 2026-09-01)
- **Aplicada 2026-09-01** — migrations `e1_reestruturacao_tabelas_precos_novas` +
  `e1b_reestruturacao_revoke_anon_writes` (arquivo: `E1_tabelas_novas.sql`; rollback:
  `E1_rollback.sql`).
  15 tabelas novas, vazias, RLS ligado + 1 política SELECT (anon+authenticated); escrita
  revogada de anon/authenticated (só `SELECT`); `service_role` mantém tudo (ingestão).
  `sinapi_itens`/`orse_itens`/`seinfra_itens` intactas (263.586 / 176.367 / 58.510).
  `get_advisors` (security): nenhum aviso nas tabelas novas.
- **`stg_*` NÃO criada aqui** — formato depende dos exemplos de planilha; fica na E2 (§10-I).
- **Revisão (agente):** E1 sólida, 0 blockers. S1 (revogar escrita) — **feito** (e1b).
  S2 → §10-K (FK de `codigo_item` depois da E3). Anotações para E2/E3: itens §10-L.
- **Achado:** `public.tb_composicoes` / `tb_composicoes_itens` são a **biblioteca de
  composições customizadas do usuário** (não é tentativa anterior de normalizar preços);
  quase vazias; sem colisão de nome. Comentário adicionado à `tb_composicoes`. A função
  `public.sinapi_estrutura_sem_precos(jsonb)` (tira preços de um jsonb de composição) pode
  ser **reaproveitada** para calcular a assinatura estrutural na E3 (§10-D).
- **Objetivo:** estrutura nova criada, sem tocar em nada existente.
- **Ações:**
  - DDL de §4.1, §4.1b, §4.2–§4.5, §4.7.
  - Índices: PK de cada tabela; trigram GIN em `*_descricao(descricao)` e `*_item(codigo)`;
    btree em `*_preco(codigo, tipo_encargo, vigente_desde_ord)` e nas FKs.
  - **Segurança (§10-F):** RLS/grants das tabelas base = cópia verbatim das `*_itens` de
    hoje; decidir e registrar o modelo (recomendado: `security_invoker=true` nas views,
    que só entram na E5).
  - Checagens pré-migração (registrar resultado no §12): `identificacao` único por código
    (§10-H — repetir); assinatura de composição onerada×desonerada por fonte (§1 — repetir).
- **Revisão:** DDL conferido contra §3 (tipos/colunas exatos); pontos A/F resolvidos no
  DDL; nenhum objeto existente alterado.
- **Reverter:** `DROP` das tabelas novas (estão vazias).
- **Depende de:** E0.

### E2 — Comando de comparação ("grava só o que mudou") ✅ (2026-09-01)
- **Migrations:** `e2_reestruturacao_funcoes_delta`, `e2b_reestruturacao_composicao_multiforma`,
  `e2c_fix_migrar_drivers`, `e2d_pick_descricao_limpa`, `e2e_fix_migrar_seinfra_order`.
  Arquivos: `E2_funcoes_delta.sql`, `E2b_composicao_multiforma.sql`. Rollback: `E2_rollback.sql`.
- **Entregues:** `stg_sinapi/orse/seinfra` (formato = `*_itens` de hoje, admin-only);
  helpers `rt_norm_encargo`, `rt_ord_de_data`, `rt_tok`, `rt_comp_canon` (normaliza as 2
  formas do jsonb SINAPI), `rt_pick_desc` (evita descrição com corrupção de encoding);
  `rt_aplicar_sinapi/orse/seinfra` (grava delta); `rt_aplicar_composicao_sinapi/seinfra`
  (backfill da analítica de um mês antigo — §10-M opção B); `rt_migrar_*_legado`.
- **Decisão §10-M:** adotada **opção B** (mês sem analítica → última conhecida; parser lê
  a forma B do 2026-06). Objetivo: analítica em todos os meses de 2025/2026 dentro de 500 MB.

### E3 — Migrar histórico (SINAPI, ORSE, SEINFRA) ✅ reconciliado (2026-09-01)
- **SINAPI** (11 refs) / **ORSE** (16 refs) / **SEINFRA** (2 refs) migrados a partir das
  `*_itens` atuais. Reconciliação (fachada reconstruída vs. legado, por (ref,codigo,encargo)):

  | Fonte | chaves legado | chaves novo | perdidas | a mais | dif. preço/unid/ident | dif. descrição |
  |---|---:|---:|---:|---:|---:|---:|
  | SINAPI  | 252.667¹ | 252.674 | **0** | 7² | **0** | 8³ |
  | ORSE    | 176.367 | 176.367 | **0** | 0 | **0** | **0** |
  | SEINFRA | 58.506  | 58.506  | **0** | 0 | **0** | 37³ |

  ¹ legado tinha **10.919 linhas duplicadas** (mesmo ref+codigo+encargo) — o modelo novo
  as elimina (§10-O). ² 7 linhas "curadas": item com buraco de 1 mês num só encargo;
  presença é por código, não por (código,encargo) — filosofia da opção B, aceito (§10-P).
  ³ artefato da query de conferência (junta com as 2 variantes duplicadas do legado);
  verificado: **toda** descrição do modelo novo casa com alguma descrição do legado para
  aquele codigo+ref, e `sinapi_descricao`/`seinfra_descricao` têm **0** descrições com
  caractere de corrupção (o legado tinha).
- **Composição** reconciliada por assinatura estrutural: SINAPI 2025-08 (forma A) 7.907/7.907
  iguais; SINAPI 2026-06 (forma B) 10.454/10.454 iguais. **0 diferenças.**
- **Tamanho pós-`VACUUM FULL`:** modelo novo das 3 fontes = **76 MB** (SINAPI ~45, ORSE ~18,
  SEINFRA ~13), com analítica de todos os meses que a têm. Legado ainda ocupa 371 MB (sai
  na E6/E7). DB total hoje 481 MB → **~110 MB** depois da E6/E7.
- **Reverter:** `TRUNCATE` das tabelas novas + `DELETE FROM referencia_carregada`.

### E2 (desenho original) — Comando de comparação ("grava só o que mudou")

### E2 (desenho original) — Comando de comparação ("grava só o que mudou")
- **Objetivo:** funções `aplicar_sinapi(ref)`, `aplicar_orse(ref)`, `aplicar_seinfra(ref)`
  que leem `stg_<fonte>` e gravam apenas deltas.
- **Ações:**
  - Definir o formato de `stg_<fonte>` a partir dos **exemplos de planilha** (§10-I).
  - Comparação sempre com `IS DISTINCT FROM` (§8, item 1).
  - Fechar a definição da assinatura estrutural da composição (§10-D): `ordem` fora da
    assinatura; `coeficiente` normalizado; `categoria` dentro (SEINFRA).
  - Atualizar `*_item_presenca` (abrir/estender/fechar intervalos).
  - Testar com 1 referência de exemplo (a partir dos dados atuais).
- **Revisão:** rodar a mesma referência 2x — a 2ª não insere nada. Primeira aparição de
  item gera linha de descrição e de preço. Item reaparecido após buraco volta a aparecer.
- **Reverter:** `DROP FUNCTION` + `TRUNCATE` das tabelas novas.
- **Depende de:** E1 + **exemplos de planilha** (pasta `tabelas`).

### E3 — Migrar histórico SINAPI ⬜
- **Ações:**
  - Reprocessar as referências em ordem crescente, a partir de `sinapi_itens`.
  - **Regra da fonte da verdade (§10-G):** a linha plana vence; valores embutidos no jsonb
    (`descricao_item`/`preco_unitario`/`valor_total`) são descartados. Rodar verificação de
    órfãos e sintetizar catálogo/descrição/preço para `codigo_item` sem linha plana.
- **Revisão:** protocolo §8 + **reconciliação de 1 referência inteira a 100% (§8.1)**;
  checagem de órfãos zerada; `identificacao`/assinatura de encargo conferidas.
- **Reverter:** `TRUNCATE` das tabelas novas de SINAPI.
- **Depende de:** E2.

### E4 — Migrar histórico ORSE e SEINFRA ⬜
- Igual E3, por fonte. **Antes da SEINFRA:** decidir §10-E (`valor_total` recalculado vs.
  guardado) com base numa amostra reconciliada.
- **Revisão:** §8.1 para cada fonte; SEINFRA — conferir o total por categoria do modal.
- **Depende de:** E2 (E3 é o piloto).

### E5 + E6 — Fachadas + virada ✅ (2026-09-01)
- **Migrations:** `e5_fachadas_views`, `e5b_fachadas_perf`, `e5c_fachadas_preco_distinct_on`,
  `e2f_hardening_revisor_e2e3`. Arquivo: `E5_fachadas.sql` (estado final nas migrations e5b/e5c).
- `sinapi_itens` / `orse_itens` / `seinfra_itens` renomeadas p/ `*_itens_old` e recriadas
  como **views** (`security_invoker=true`) sobre o modelo novo. `GRANT SELECT` a
  anon/authenticated. `NOTIFY pgrst`.
- **Desempenho** (era ~1900 ms a busca): desnormalizei `descricao`/`unidade` "atuais" em
  `*_item` (histórico fica em `*_descricao`) + índice trigram em `*_item.descricao` +
  resolução de preço por `DISTINCT ON` + `VACUUM ANALYZE`. Resultado: **busca 79 ms**,
  **modal de detalhe 6 ms**.
- **Front-end:** 2 edições mínimas — `.select('*')` → lista de colunas **sem `composicao`**
  nas duas consultas de **busca** (`modules/tabelas/tabelas.js`,
  `modules/composicoes/composicoes.js`); detalhe/impressão seguem com `select('*')`.
- **Composição:** funções `rt_composicao_sinapi/seinfra` remontam o jsonb na forma A que o
  front-end lê. `descricao_item`/`unidade` dos filhos vêm de `*_item` (atual).
  `valor_total` = `round(coeficiente × preço, 2)` (§10-E).
- **Reconciliação view vs `*_itens_old`** (SINAPI 2025-08): 0 perdas, 3 "curadas", 0 dif. preço.
- Correções do revisor E2/E3 aplicadas (e2f): EXECUTE revogado de anon/auth em todas as
  `rt_*`; `search_path` nos 7 helpers; guarda de carga fora de ordem; `round(,10)` no `rt_tok`.
- **Reverter:** `DROP VIEW *_itens` + `ALTER TABLE *_itens_old RENAME TO *_itens` +
  `NOTIFY pgrst` — **só possível antes da E7**.

### E5b — Teste de restauração do backup ⚠️ NÃO EXECUTADO
- Não foi possível (o `db-url.local` foi apagado e os CSVs saíram do projeto). O responsável
  confirmou visualmente os 3 CSVs íntegros fora do projeto (2026-09-01) e autorizou a E7
  sem o teste. **Recomendação:** testar a restauração de 1 CSV num schema de rascunho na
  próxima janela com acesso ao banco (README_E0 tem o procedimento).

### E7 — Limpeza e medição ✅ (2026-09-01)
- Migration `e7_drop_tabelas_legado`: `DROP TABLE sinapi_itens_old / orse_itens_old /
  seinfra_itens_old`. Índices legados sem uso já haviam sido removidos antes.
- `VACUUM FULL`.
- **Resultado:**

  | | Antes | Depois |
  |---|---:|---:|
  | Modelo de preços (3 fontes) | 372 MB | **79 MB** |
  | Banco inteiro | 481 MB | **101 MB** |

  Folga de ~400 MB no plano gratuito. `get_advisors` (security): nenhum aviso novo além de
  3 INFO `rls_enabled_no_policy` nas `stg_*` (intencional — admin-only).
- **Reverter:** só via backup CSV (E0) + reimportar + re-rodar `rt_migrar_*_legado`.

### E5 — Criar as fachadas (views) — desenho original ⬜
- **Ações:** views `sinapi_itens` / `orse_itens` / `seinfra_itens` (§4.6), com as tabelas
  antigas ainda vivas sob outro nome (sufixo `_old`) — testar lado a lado.
  `security_invoker=true`; `ORDER BY codigo`; `id` = `hashtextextended` (§4.6).
- **Revisão — checklist de regressão (todos):**
  1. busca por código; 2. busca por descrição; 3. SINAPI onerada; 4. SINAPI desonerada;
  5. SEINFRA onerada (tem de pegar o legado `não desonerada` → `onerada`); 6. SEINFRA
  desonerada; 7. agrupamento por categoria da SEINFRA; 8. modal de detalhe SINAPI;
  9. modal de detalhe SEINFRA + link externo; 10. impressão (`imprimirLinhaTabela`);
  11. link externo ORSE; 12. dropdown de versão via `obterMesesDisponiveis` **e** o probe
  fixo `["30","29","28","27","26"]` da SEINFRA; 13. caminho "não encontrado" do `.single()`.
  - `EXPLAIN` das consultas 1–2 usa índice trigram; jsonb montado só nas linhas limitadas.
  - Tudo com a chave **anon**.
- **Reverter:** `DROP VIEW`.
- **Depende de:** E3 + E4.

### E5b — Testar a restauração do backup E0 ⬜
- **Ações:** restaurar 1 dos CSVs da E0 para um schema de rascunho (`COPY ... HEADER match`);
  conferir contagem e `setval` da sequência. Confirma que o backup é utilizável.
- **Depende de:** E0. **Deve estar ✅ antes da E6.**

### E6 — Virada ⬜  **(destrutiva — exige "ok" explícito)**
- **Ações:** renomear `*_itens` → `*_itens_old`; ativar as views como `*_itens`;
  `NOTIFY pgrst, 'reload schema';`; smoke test das telas com a chave anon.
- **Revisão:** checklist §E5 refeito na tela real; `get_advisors`; nenhuma referência
  quebrada; PostgREST recarregado (sem 404/500).
- **Reverter:** `DROP VIEW *_itens` + renomear `*_itens_old` → `*_itens` +
  `NOTIFY pgrst, 'reload schema';`.
- **Depende de:** E5 e E5b aprovadas.

### E7 — Limpeza e medição ⬜  **(destrutiva — exige "ok" explícito)**
- **Ações:** `DROP TABLE *_itens_old`; depois, **fora de transação / bloco** (não roda no
  editor SQL com auto-commit desligado): `VACUUM (FULL, ANALYZE)` nas tabelas novas.
  Medir `pg_database_size` e o tamanho de cada objeto; comparar com a estimativa §4.8;
  confirmar folga na métrica **Database size** (500 MB) do plano gratuito.
- **Revisão:** tamanho final dentro da estimativa; telas ok pós-vacuum.
- **Reverter:** só via backup E0 (por isso E0/E5b são pré-requisito).
- **Depende de:** E6 + alguns dias de uso sem incidente.

### E8 — Documentar a carga mensal ✅ (2026-09-02)
- Pasta `sql/reestruturacao_tabelas/` reorganizada:
  - `COMO_CARREGAR.md` — índice + formato do CSV + regras + funções.
  - `SINAPI/` — extrator (`gerar_stg_sinapi.py` + `.bat` + `.pyw`), `subir_stg_sinapi.mjs`,
    `carga_sinapi_manual.sql`, `LEIA-ME.md`.
  - `ORSE/` e `SEINFRA/` — `carga_<fonte>_manual.sql` + `LEIA-ME.md` (CSV vem do
    programa do responsável; extrator dedicado pode ser feito depois).
  - (os scripts E0..E5f foram removidos em 2026-09-02 — já aplicados; ficam nas
    migrations do Supabase `e0`..`e6b` e no histórico deste arquivo).
  - `node_modules/`, `package*.json` na raiz da pasta (deps dos `.mjs`).
  - Removidos: `__pycache__/`, cópias de `.xlsx`/`.csv` (agora no `.gitignore`).

---

## 10. Pontos técnicos

- **A — Item que some (descontinuado): RESOLVIDO (2026-09-01).** Verificado: itens somem e
  voltam (ORSE 9.243/19.530 códigos; SINAPI 2.681/15.481; SEINFRA 0). Solução: tabela de
  presença por **intervalos contíguos** (§4.1b), com JOIN explícito na fachada (§4.6).
- **B — Desempenho da fachada: RESOLVIDO no desenho (2026-09-01).** Fachada em duas camadas
  (§4.6): camada plana escalar (o `ilike` alcança o trigram das tabelas base) + composição
  só para as ≤1000 linhas já filtradas. Confirmar planos de execução na E5.
- **C — `id` sintético: RESOLVIDO (2026-09-01).** Revisor confirmou: o front-end nunca lê,
  ordena ou filtra por `id` nessas 3 tabelas. `hashtextextended(...,0)` de 64 bits com
  separador `|` (§4.6).
- **D — Assinatura estrutural da composição (definir na E2):** faz parte da assinatura a
  `ordem` das linhas? (recomendado: **não** — reordenar não gera versão nova; guarda-se a
  `ordem` da carga mais recente). Normalizar `coeficiente` (ex. `::numeric`, escala fixa)
  antes de comparar, senão `1.0` vs `1.00` no texto do jsonb vira "mudou" à toa. Incluir
  `categoria` (SEINFRA) na assinatura.
- **E — `valor_total` da SEINFRA (decidir antes da E4):** o front-end hoje **lê**
  `item.valor_total` do jsonb e soma nos totais por categoria do modal. Recalcular
  `round(coeficiente × preço, 2)` pode divergir por centavos (preço do filho com 4 casas,
  truncamento por linha). Conferir uma amostra: se divergir, guardar `valor_total` na
  `seinfra_composicao`; se bater, recalcular. O preço de capa (`preco_unitario` do pai) não
  é afetado — vem de §4.3.
- **F — Segurança das views (definir na E1):** views do Postgres 15+ rodam como o dono e
  **ignoram RLS** das tabelas base por padrão. Usar `security_invoker = true` nas views +
  replicar RLS/grants das `*_itens` atuais nas tabelas base. PostgREST precisa da view no
  schema exposto + `GRANT SELECT` ao papel `anon` + `NOTIFY pgrst, 'reload schema'`.
- **G — Códigos que só existem dentro da composição (tratar na E3):** numa referência, um
  `codigo_item` pode aparecer só como filho dentro do jsonb de um pai (com `descricao_item`
  e `preco_unitario` embutidos), sem ter linha plana própria naquele mês. Regra:
  **a linha plana vence**; os valores embutidos no jsonb são descartados na migração.
  Rodar verificação de órfãos: todo `codigo_item` referenciado por uma estrutura na
  referência `R` tem de resolver descrição+preço em `R`. Para os que não resolverem,
  sintetizar linhas de catálogo/descrição/preço a partir do embed do jsonb.
- **H — `identificacao` é único por código: VERIFICADO (2026-09-01).** 0 códigos com
  `identificacao` variável nas 3 fontes → pode ficar no catálogo (§4.1). Repetir o check
  na E3 antes de assumir.
- **I — `stg_<fonte>`:** formato final (linhas de composição achatadas vs. coluna jsonb)
  depende dos exemplos de planilha. **Decidir na E2.**
- **J — `referencia_ord` = `AAAAMM`** é não-contíguo (202512 → 202601). OK para `<=` e para
  conter intervalo; **não** iterar range de ord. SEINFRA usa o número da tabela como int —
  quebra se algum dia vier `"28A"` (hoje a coluna é `varchar(10)`).
- **K — FK de `codigo_item` (depois da E3):** `*_composicao.codigo_item` nasceu sem FK de
  propósito (órfãos na migração, §10-G). Depois da E3 + síntese de órfãos + reconciliação
  §8.1: `ADD CONSTRAINT ..._codigo_item_fkey FOREIGN KEY (codigo_item) REFERENCES
  ..._item(codigo) NOT VALID;` e `VALIDATE CONSTRAINT` em janela ociosa. Pega CSV mensal
  que referencie insumo fora do catálogo.
- **M — `composicao` do SINAPI legado tem 3 situações (decisão pendente):**
  - NULL em `2025-01`, `2026-02`, `2026-03` → modal hoje não mostra composição.
  - **array** (forma A: `codigo_item`/`descricao_item`/`tipo_item`/`coeficiente`/
    `preco_unitario`/`valor_total`/`unidade`) em `2025-07`..`2026-01` (7 refs) → modal mostra.
  - **object** (forma B: `{grupo, itens:[{tipo, codigo, descricao, valor, coeficiente,
    preco_unitario, unidade, situacao}], perc_as}`) em `2026-06` → o front-end faz
    `Array.isArray` e **não mostra** (dado existe, mas fica invisível hoje).
  SEINFRA: array consistente nas 2 refs. ORSE: sem composição.
  **Opções:** (A) fiel — 4 refs sem composição na fachada, igual hoje; (B) manter a última
  composição conhecida quando um mês não traz a estrutura (2026-02/03/06 herdam;
  `2025-01` fica sem, não há anterior) + parsear a forma B do 2026-06; (C) híbrido.
  `rt_aplicar_sinapi` atual já faz (B) para NULL (não insere → última versão continua
  vigente); falta só ensinar o parser a ler a forma B.
  **DECIDIDO (2026-09-01): opção B.** Objetivo do responsável: sintética + analítica em
  todos os meses de 2025/2026 dentro de 500 MB. `rt_comp_canon` lê as formas A e B;
  `rt_aplicar_composicao_<fonte>` completa a analítica de um mês antigo depois.
  Reconciliação feita em 2025-08 (forma A) e 2026-06 (forma B): 0 diferenças.
- **N — Corrupção de encoding em descrições duplicadas do legado (2026-09-01):** ~8 (SINAPI)
  / ~37 (SEINFRA) códigos têm 2 descrições no mesmo ref, uma com `U+FFFD` (ex. `MEC��NICO`).
  `rt_pick_desc` faz a deduplicação preferir a variante sem `U+FFFD` (depois a mais longa).
  Resultado: 0 descrições corrompidas nas tabelas novas.
- **O — Duplicatas no legado (2026-09-01):** `sinapi_itens` tem 10.919 linhas com
  (referencia, codigo, tipo_encargo) repetido. O modelo novo deduplica (chave natural).
  ORSE e SEINFRA não têm duplicatas.
- **P — Presença é por código, não por (código, encargo):** quando o legado tem um buraco
  de 1 mês só para UM encargo de um código, o modelo novo emite a linha desse encargo
  (preço carregado). 7 casos em toda a SINAPI. Consistente com a opção B; aceito. Só
  reavaliar se um cliente reclamar de item "a mais" num mês.
- **L — Notas do revisor para E2/E3:**
  - `*_preco` e `seinfra_composicao` têm CHECK `tipo_encargo IN ('onerada','desonerada')`.
    O legado também tem `onerado`/`desonerado` e `não desonerada`. **Normalizar antes do
    INSERT** (senão o CHECK rejeita): `onerado→onerada`, `desonerado→desonerada`,
    `não desonerada→onerada`.
  - Síntese de órfão (§10-G): `identificacao` vem de `tipo_item` (`INSUMO→I`,
    `COMPOSICAO→C`); `descricao` cai no `descricao_item` embutido no jsonb (ambas colunas
    são `NOT NULL`).
  - `sinapi_composicao` PK usa `ordem` (posição), não `codigo_item` — não garante insumo
    único por versão; a carga da E3 não pode duplicar linhas do mesmo insumo.
  - Nomes das políticas novas ("Leitura publica ...", sem acento) diferem do legado
    ("Leitura pública SINAPI") — cosmético, sem ação.

## 11. Registro de decisões (entrevista de 2026-09-01)

1. Histórico: manter **todos os meses** consultáveis, sem duplicar o que não muda.
2. Antes de apagar qualquer coisa: backup completo, conferido.
3. Composição: guardar só a **estrutura**; descrição e preço dos elementos vêm por JOIN.
4. Descrição: guardar **histórico** (versão nova só quando muda).
5. Fachadas com os nomes antigos → **zero mudança no front-end**.
6. Carga futura: programa gera CSV → sobe em `stg_<fonte>` pela tela do Supabase → roda 1
   comando que grava só o delta.
7. Migração do histórico: reprocessar a partir dos dados já no banco (não precisa das
   planilhas originais).
8. Backup fora do banco: 1 CSV por tabela. Nada fica no banco.
9. `onerada`/`desonerada`: normalizar para 2 valores fixos; `não desonerada` → `onerada`.
10. Plano gratuito (500 MB): restrição **fixa**.
11. ORSE: sem composição (fica no link externo).
12. Execução por etapas, com este arquivo como registro e agentes revisores por etapa.

## 12. Log de execução

| Data | Etapa | O que foi feito | Revisão | Resultado |
|---|---|---|---|---|
| 2026-09-01 | — | Levantamento no banco + no código; entrevista; criação deste plano | — | Plano aprovado pelo responsável |
| 2026-09-01 | Ponto A | Verificado que itens somem e voltam (ORSE 47%, SINAPI 17%) | — | Adotada tabela de presença por intervalos (§4.1b) |
| 2026-09-01 | E0 | Criados script de backup CSV + README | agente revisor | Ver correções abaixo |
| 2026-09-01 | Plano | Agente revisor auditou §4 + script E0 | — | 5 blockers + 12 should-fix incorporados (§13) |
| 2026-09-01 | Ponto B1 | Estrutura de composição onerada×desonerada: SINAPI 0/55.986 difere; SEINFRA 3/8.850 | — | SEINFRA `composicao` ganha `tipo_encargo`; SINAPI não |
| 2026-09-01 | Ponto H | `identificacao` nunca varia por código (3 fontes) | — | Fica no catálogo (§4.1) |
| 2026-09-01 | E0 | Backup gerado (3 CSVs, contagens conferidas). Fix: `sslmode` na URL fazia o pg novo exigir verify-full → TLS agora só pelo objeto `ssl` | auto-conferência do script | ✅ geração; falta copiar `backup/` para fora e apagar `db-url.local` |
| 2026-09-01 | E1 | Migration `e1_...`: 15 tabelas novas vazias + índices + RLS/políticas. Tabelas atuais intactas. | agente revisor | ✅ Sólida, 0 blockers |
| 2026-09-01 | E1b | Migration `e1b_...`: revoga escrita de anon/authenticated nas 15 tabelas (revisor S1); comentário em `tb_composicoes` | verificado (grants = só SELECT) | ✅ |
| 2026-09-01 | E2 | Migration `e2_...`: stg_* + funções `rt_aplicar_*` + `rt_migrar_*_legado` | piloto SINAPI 2025-01 | ✅ funções OK; piloto desfeito |
| 2026-09-01 | E2/piloto | Descoberto: `composicao` SINAPI legado varia de forma (NULL / array / object) entre referências | — | §10-M decidido: opção B |
| 2026-09-01 | E2b..E2e | Parser multiforma (`rt_comp_canon`), backfill de analítica, `rt_pick_desc`, fixes dos drivers | — | ✅ |
| 2026-09-01 | E3 | Migração SINAPI+ORSE+SEINFRA a partir do legado; reconciliação por (ref,codigo,encargo) e por assinatura de composição | conferência inline | ✅ 0 chaves perdidas, 0 dif. preço; composição 0 dif.; achados §10-N/O/P |
| 2026-09-01 | E3 | `VACUUM FULL` nas tabelas novas | — | modelo novo = 76 MB (3 fontes); DB total 481 MB (cai p/ ~110 MB após E6/E7) |
| 2026-09-01 | E2f | Correções do revisor E2/E3: EXECUTE revogado, search_path, guarda fora de ordem, round(,10) | verificado | ✅ |
| 2026-09-01 | E5/E6 | Views de fachada no ar; desnormalização de descrição p/ desempenho; 2 edições no front-end; correções do revisor | reconciliação + EXPLAIN | ✅ busca 79 ms, detalhe 6 ms |
| 2026-09-01 | E5b | Teste de restauração do backup | — | ⚠️ NÃO executado (sem acesso); responsável confirmou CSVs íntegros e autorizou E7 |
| 2026-09-01 | E7 | `DROP TABLE *_itens_old` + `VACUUM FULL` | get_advisors ok | ✅ **DB 481 → 101 MB**; preços 372 → 79 MB |
| 2026-09-02 | Rev. E5-E7 | Agente revisor: fidelidade das views 100% (29 refs). 1 blocker + 4 should-fix | — | ver §14 |
| 2026-09-02 | E5d/E5e | Fixes: `rt__sync_item_desc` wired + revogado; dropdown lê `referencia_carregada` (front-end); drop `rt_migrar_*`; síntese de órfãos p/ cargas futuras; revoke escrita nas views | — | ✅ |
| 2026-09-02 | SINAPI reload | Responsável zerou SINAPI. Criado `gerar_stg_sinapi.py` (lê a planilha da Caixa: abas ISD/ICD/CSD/CCD/Analítico, regra CE→SP, código das composições vem de fórmula HYPERLINK, monta composicao). Testado ponta-a-ponta com 2025-01 (amostra) → view remonta composição OK. | teste manual | ✅ script pronto |
| 2026-09-02 | E6/E6b | Migrations: preço `'ambas'` quando onerada=desonerada (1 linha em vez de 2, insumos e composições) via `rt__preco_sinapi`; view expande 'ambas' em onerada+desonerada; coluna `origem` (CE/SP) em `sinapi_preco` + `stg_sinapi` + `sinapi_itens` (e `origem_preco` NULL nas views ORSE/SEINFRA p/ uniformizar o `select`); `rt_composicao_sinapi` traz `origem_preco` por insumo. Extrator emite `origem_preco`. Front-end: selo "SP" na busca e no modal + `origem_preco` no select. | teste manual (7 preços em vez de 10; SP flui até o jsonb) | ✅ |
| 2026-09-02 | SINAPI 2025-01 | Carga real do 1º mês: 14.505 códigos, 19.862 preços (5.440 'ambas' = −21%), 2.089 via SP, 52.095 linhas de composição. DB 91 MB. Front-end publicado — busca/composição/selo SP funcionando. | conferido | ✅ |
| 2026-09-02 | Extrator | `gerar_stg_sinapi.py` passa a **descartar** linhas sem preço em CE nem SP (eram só composições — 1.854/mês no 2025-01). Wrappers: `.bat` (arrastar), `.pyw` (janela), `subir_stg_sinapi.mjs` (COPY). Responsável refaz o 2025-01 com o CSV novo. | — | ✅ |

## 14. Revisão E5-E7 — 2026-09-02 (agente revisor)

Fidelidade das fachadas **100%** — todas as 29 referências reproduzem exatamente
(re-derivação independente). `security_invoker` OK, anon lê tudo, `get_advisors` sem
aviso novo. Achados:

- **Blocker 1 — dropdown de versão 5-10 s.** `obterMesesDisponiveis()` varria a view
  inteira (`ORDER BY referencia LIMIT 1` = 4,8 s) + ~18 `count`. **CORRIGIDO:** front-end
  passa a ler `referencia_carregada` direto (`tabelas.js` e `composicoes.js`).
- **Should-fix 2 — 1.162 sub-itens órfãos SINAPI** (codigo_item sem linha no catálogo):
  2.308 linhas de composição em 1.672/10.467 composições (16%) mostram descrição/unidade
  em branco e preço 0 no modal. **PARCIAL:** síntese adicionada às funções para cargas
  futuras (`e5e`); para os órfãos já no banco → rodar `E5f_backfill_orfaos.mjs` com o CSV.
- **Should-fix 3 — `descricao`/`unidade` da view = último carregado, não da época.**
  Desvio consciente da decisão #4 (o histórico continua em `*_descricao`, só não é lido
  pela fachada). Pares que mostram descrição "atual" em vez da "da época": SINAPI 8.523 /
  ORSE 3.099 / SEINFRA 226. Aceito por ora (prioridade: espaço + sistema no ar). Reverter
  = religar o JOIN vigente em `*_descricao` nas views + trigram lá (temos folga de ~400 MB).
- **Should-fix 4 e 5 — CORRIGIDOS (`e5e`):** `REVOKE EXECUTE` em `rt__sync_item_desc`;
  `REVOKE` escrita das views para anon/authenticated.
- **#11 — CORRIGIDO:** `rt_migrar_*_legado()` removidas (liam as views, não reutilizáveis).
- **#7 — feito:** `VACUUM ANALYZE` em `*_preco` / `*_item` (buscas frias mais rápidas).
- Nota: composição `valor_total` = `round(coeficiente × preço, 2)` (§10-E, aceito).

## 13. Revisão do plano — 2026-09-01 (agente revisor)

Disposição dos achados. Detalhe técnico nos §§ citados.

**Blockers (todos incorporados):**
- **B1** Suposição "estrutura idêntica entre encargos" não verificada → verificada nos
  dados; SEINFRA passa a ter `tipo_encargo` na composição (§1, §4.4).
- **B2** Modelo de segurança das views indefinido → §10-F + §4.6 (`security_invoker=true`,
  grants copiados, teste com chave anon).
- **B3** `ilike + limit` sobre view com `jsonb_agg` mata o índice trigram → fachada em duas
  camadas (§4.6, §10-B).
- **B4** `codigo_item` órfão (só dentro da composição) renderiza em branco → §10-G (linha
  plana vence + síntese de órfãos), verificação obrigatória na E3.
- **B5** Backup sem restauração testada e `SELECT *` pode não reimportar → `id` é
  `GENERATED BY DEFAULT` (reimporta ok com `HEADER match`, PG17); restauração documentada
  no README_E0 e testada na nova etapa **E5b** (antes da E6).

**Should-fix (incorporados):** `IS DISTINCT FROM` na comparação (§8); JOIN de presença
explícito na fachada (§4.6); `identificacao` conferido (§10-H); drift de `valor_total`
SEINFRA (§10-E, decisão na E4); hash `id` com separador (§4.6); paridade de colunas/tipos
sem extras (§4.6); `ORDER BY codigo` na view (§4.6); hardening do E0 (TLS, `statement_timeout`,
conferência de linhas gravadas — feito); definição da assinatura estrutural (§10-D);
`NOTIFY pgrst` na E6; reconciliação de 1 referência inteira na E3/E4 (§8.1); checklist de
regressão da E5 enumerado.

**Nice-to-know (anotados):** `AAAAMM` não-contíguo e SEINFRA ord numérico (§10-J);
normalização de encargo é lossy — CSV do E0 é o único registro dos textos originais (§11-9);
`VACUUM FULL` fora de transação (E7); `stamp` do E0 em hora local + `process.exitCode`
(feito). Fora de escopo: `imprimirLinhaTabela` roteia `ORSE` para `seinfra_itens`
(bug pré-existente, não piora).
