# Dicionário de Schema — Assistente de Dados GECOPE

Este documento descreve as tabelas do banco de dados GECOPE em linguagem de negócio,
para uso tanto no motor de intenções (regras) quanto no prompt de geração de SQL do Gemini.

Contexto: `contratante` é a secretaria/órgão que contratou a obra (ex: SOP-CE, SEDUC, entre outras).
Não é um valor fixo — é um filtro válido, assim como `contratada` (a empresa executora).
Não confundir os dois: `contratante` = o órgão público; `contratada` = a construtora.

---

## Tabela: `processos`

**Importante**: esta tabela representa especificamente os processos de **replanilhamento**
cadastrados no sistema — não é uma tabela genérica de processos de qualquer tipo. Ou seja,
"quantos processos temos" já significa "quantos processos de replanilhamento temos".

Este é o núcleo do trabalho da GECOPE — cada processo representa uma revisão técnica feita
pela equipe sobre um pedido vindo do fiscal de campo.

| Coluna | Tipo | Significado |
|---|---|---|
| id | uuid | identificador único do processo |
| processo | text | número/identificação do processo (NUP) |
| status | text | status do processo de análise. Valores confirmados: `AGUAR. APROVAÇÃO`, `ANÁLISE FISCAL`, `APROVADO`, `ARQUIVADO`, `CONTRATANTE`, `DEVOLVIDO P/ REANÁLISE FISCAL`, `EM ANÁLISE`, `EXCLUÍDO`. **"Em tramitação" = status NÃO IN ('APROVADO', 'ARQUIVADO', 'EXCLUÍDO')**. |
| tipo | text | **tipo de edificação/obra** (ex: ESCOLA, HOSPITAL, DELEGACIA, ARENINHA, CEI) — NÃO é o tipo de processo. Não usar este campo para identificar "replanilhamento". |
| descricao | text | descrição livre do processo |
| fiscal | text | nome do fiscal de campo responsável |
| fiscal_matricula | text | matrícula do fiscal |
| contratante | text | secretaria/órgão contratante (ex: SOP-CE, SEDUC) — filtro válido, não é fixo |
| contratada | text | nome da empresa contratada |
| analista | text | analista GECOPE que revisou o processo |
| data_abertura | date | quando o processo foi aberto |
| data_recebimento | date | quando a GECOPE recebeu o processo |
| data_compromisso_fiscal | date | prazo comprometido pelo fiscal |
| data_aprovacao_gecope | date | quando a GECOPE aprovou o processo |
| data_devolucao_correcoes | date | quando foi devolvido para correção |
| acresc_fiscal / supress_fiscal / reperc_fiscal | numeric | valores de acréscimo, supressão e repercussão calculados pelo FISCAL |
| acresc_gecope / supress_gecope / reperc_gecope | numeric | valores de acréscimo, supressão e repercussão calculados/corrigidos pela GECOPE |
| prioritario | boolean | processo marcado como prioritário |
| aviso_atraso_enviado | boolean | se já foi enviado aviso de atraso |
| arquivamento_validado | boolean | se o arquivamento já foi validado |
| suite | text | referência ao sistema SUITE |
| suite_data_chegada | timestamptz | quando chegou no SUITE |
| status_pre_arquivamento | text | status de pré-arquivamento |
| codigo_obra | text | **liga com `contratos_edificacao.codigo_obra`** |
| distrito_operacional | text | distrito operacional do processo |
| municipio | text | município do processo |
| data_exclusao | timestamptz | se preenchido, processo foi excluído |
| excluido_por | text | quem excluiu |

**Observação importante**: `reperc_fiscal` vs `reperc_gecope` é a métrica-chave de impacto
do trabalho da GECOPE — a diferença entre os dois representa o valor que a revisão técnica
da GECOPE corrigiu em relação ao cálculo original do fiscal de campo.

---

## Tabela: `contratos_edificacao`

Dados cadastrais e financeiros de cada contrato/obra de edificação.

| Coluna | Tipo | Significado |
|---|---|---|
| id_obra | integer | identificador da obra |
| codigo_obra | text | **liga com `processos.codigo_obra`** |
| id_contrato | integer | **liga com `aditivos_contrato.id_contrato` e `ficha_contrato.id_contrato`** |
| nr_contrato_sop | text | número do contrato na SOP |
| descricao_obra | text | descrição da obra |
| contratada | text | empresa contratada |
| cnpj_contratada | text | CNPJ da contratada |
| contratante | text | secretaria/órgão contratante (ex: SOP-CE, SEDUC) — filtro válido |
| cnpj_contratante | text | CNPJ do contratante |
| municipio | text | município da obra |
| distrito_operacional | text | distrito operacional |
| status_obra | text | status físico da obra. Valores confirmados: `Aguardando OS`, `Em Execução`, `Paralisada`. Independente de `status_contrato` e de `processos.status`. |
| status_contrato | text | status administrativo do contrato. Valores confirmados: `Vigente`, `Vigência Vencida`. |
| valor_original | numeric | valor original do contrato |
| total_aditivo | numeric | total já aditivado |
| valor_atual | numeric | valor atual do contrato (original + aditivos) |
| prazo_execucao | integer | prazo de execução em dias |
| dias_aditivado | integer | dias já aditivados no prazo |
| dias_paralisado | integer | dias que a obra está parada |
| data_assinatura | date | assinatura do contrato |
| data_fim_previsto | date | previsão de término da execução |
| data_fim_vigencia_contrato | date | fim da vigência contratual |

---

## Tabela: `aditivos_contrato`

Cada linha é um aditivo contratual específico.

| Coluna | Tipo | Significado |
|---|---|---|
| id_contrato | integer | **liga com `contratos_edificacao.id_contrato`** |
| nr_aditivo | text | número do aditivo |
| tipo_aditivo | text | tipo do aditivo. Valores confirmados: `Valor`, `Execução`, `Vigência e execução`, `Vigência`, `Reajuste de Preço`, `Alteração Contratual Diversa`, `Sub-Rogação`, `Valor, vigência e execução` |
| valor_aprovado | numeric | valor aprovado do aditivo |
| valor_repercussao | numeric | valor de impacto financeiro do aditivo (não confundir com valor total do contrato) |
| valor_supressao | numeric | valor suprimido, se houver |
| execucao_aprovado | integer | percentual/dias de execução aprovados |
| prazo_aprovado | integer | prazo aprovado no aditivo |
| data_protocolo | date | quando foi protocolado |
| data_assinatura | date | quando foi assinado |
| data_publicacao | date | quando foi publicado |

---

## Tabela: `ficha_contrato`

Visão consolidada e financeira do contrato — uma "ficha resumo".

| Coluna | Tipo | Significado |
|---|---|---|
| id_contrato | integer | **liga com `contratos_edificacao.id_contrato`** |
| gestor_matricula / gestor_nome | text | gestor responsável pelo contrato |
| contratada_razao_social | text | razão social da contratada |
| contratante_razao_social | text | razão social do contratante (secretaria/órgão) |
| valor_original | numeric | valor original |
| total_aditivo | numeric | total aditivado |
| valor_atual | numeric | valor atual do contrato |
| total_medido | numeric | total já medido/pago |
| saldo_contrato | numeric | saldo restante do contrato |
| percentual_aditivo | numeric | % de aditivo sobre o valor original (relevante para limite legal, ex: 25%/50%) |
| percentual_total_medido | numeric | % já medido do contrato |
| dias_a_vencer | integer | dias restantes até o vencimento |
| data_fim_vigencia | date | fim de vigência |

---

## Tabela: `medicoes`

Medições físico-financeiras realizadas nas obras.

| Coluna | Tipo | Significado |
|---|---|---|
| id_obra | integer | **liga com `contratos_edificacao.id_obra`** |
| nr_medicao | integer | número sequencial da medição |
| valor_medido | numeric | valor efetivamente medido |
| total_a_glosar | numeric | valor glosado (recusado) nesta medição |
| periodo | text | período de referência da medição |
| descricao_status_medicao | text | status da medição |
| medicao_administrativa | boolean | se é medição administrativa (vs. normal) |

---

## Tabela: `checklist_documentacao_aditivo`

Checklist de documentos exigidos para análise de um aditivo.

| Coluna | Tipo | Significado |
|---|---|---|
| processo_id | uuid | **liga com `processos.id`** |
| eh_primeiro_aditivo | boolean | se é o primeiro aditivo do contrato |
| planilha_orcamentaria_validada | boolean | planilha orçamentária já validada |
| memoria_calculo | boolean | memória de cálculo presente |
| parecer_tecnico | boolean | parecer técnico presente |
| art_fiscalizacao / art_execucao | boolean | ARTs de fiscalização/execução presentes |

---

## Tabela: `comissao_fiscalizacao`

Pessoas designadas para a comissão de fiscalização de cada obra.

| Coluna | Tipo | Significado |
|---|---|---|
| id_obra | integer | **liga com `contratos_edificacao.id_obra`** |
| codigo_obra | text | código da obra |
| tipo | text | papel na comissão. Valores confirmados: `Fiscal`, `Presidente`, `Suplente`, `1o Membro`, `2o Membro`, `3o Membro`, `4o Membro`. Para contar fiscais, filtrar `tipo = 'Fiscal'`. |
| nome_completo | text | nome da pessoa |
| matricula | text | matrícula |

---

## Tabela: `aditivo_tipos`

Tabela de referência com os tipos de aditivo possíveis.

| Coluna | Tipo | Significado |
|---|---|---|
| tipo | text | nome do tipo de aditivo (**valores exatos pendentes**) |

---

## Tabela: `curva_abc_versoes` / `curva_abc_itens`

Análise de curva ABC vinculada a um processo — classifica itens por relevância financeira.

`curva_abc_versoes.processo_id` **liga com `processos.id`**.
`curva_abc_itens.versao_id` liga com `curva_abc_versoes.id`.

Colunas relevantes em `curva_abc_itens`: `classe` (A/B/C), `valor`, `v_acresc`, `v_suprim`.

---

## Views prontas (reaproveitar em vez de recalcular)

| View | Uso |
|---|---|
| `vw_gecope_revisao_anual` | revisão consolidada por ano |
| `vw_gecope_revisao_consolidado` | revisão consolidada geral |
| `vw_gecope_revisao_detalhe` | detalhe por processo do impacto da revisão GECOPE |

**Nota**: `vw_gecope_kpi_comparativo`, `vw_gecope_auditoria` e `vw_gecope_inconsistencias`
foram mencionadas em conversas anteriores mas **não existem** neste banco — confirmado via
`information_schema.views` em set/2026. Se forem criadas no futuro, adicionar aqui e no
`schema_prompt.ts`, além de conceder `GRANT SELECT` para a role `gecope_ia_readonly`.

---

## Relacionamentos confirmados

```
processos.codigo_obra          → contratos_edificacao.codigo_obra
contratos_edificacao.id_contrato → aditivos_contrato.id_contrato
contratos_edificacao.id_contrato → ficha_contrato.id_contrato
contratos_edificacao.id_obra     → medicoes.id_obra
contratos_edificacao.id_obra     → comissao_fiscalizacao.id_obra
processos.id                     → checklist_documentacao_aditivo.processo_id
processos.id                     → curva_abc_versoes.processo_id
```

**Nota**: `processos.status` (status do processo de análise) e `contratos_edificacao.status_obra`
(status físico da obra) são campos independentes — não confundir.

---

## Regras de negócio confirmadas

- `contratante` é a secretaria/órgão (SOP-CE, SEDUC, etc.) — filtro válido, assim como `contratada`.
- A tabela `processos` cobre exclusivamente processos de replanilhamento.
- "Em tramitação" = `processos.status NOT IN ('APROVADO', 'ARQUIVADO', 'EXCLUÍDO')`.
- `processos.status` e `contratos_edificacao.status_obra` são independentes — nunca confundir.
