-- ============================================================================
-- F4 — Views largas para Q&A do Assistente de Dados
-- ============================================================================
-- Objetivo: dar ao caminho LLM (e à F5/F6) uma visão pronta, sem JOIN manual,
-- de obra+contrato+ficha+fiscal+processos — evitando o fan-out que o
-- rev-correcao encontrou na revisão da F3 (id_contrato não é a chave de
-- contratos_edificacao; um id_contrato pode aparecer em até 14 obras).
--
-- Cardinalidades confirmadas em 04/09/2026 (qexdnxqmiaarzwwwrcor), antes de
-- desenhar as views:
--   contratos_edificacao.id_contrato -> ficha_contrato.id_contrato   : 1:1 (máx 1)
--   contratos_edificacao.id_obra -> comissao_fiscalizacao (Fiscal)   : 1:até 2 (média 1,03)
--   72 obras sem nenhum fiscal cadastrado
--   contratos_edificacao.codigo_obra                                : único (0 duplicatas)
--   processos.codigo_obra -> contratos_edificacao.codigo_obra       : 352/427 processos
--     têm codigo_obra NULO (não vinculados a obra ainda); 3 apontam para um
--     codigo_obra que não existe mais; só 72 têm vínculo válido
--   processos por codigo_obra (quando não-nulo)                     : máx 2 (3 grupos)
--
-- Duas views (não uma) por causa disso: juntar processos na view de obra via
-- LEFT JOIN esconderia os 352 processos sem vínculo de qualquer pergunta feita
-- a partir da view de obra.
--
-- Ambas security_invoker = true (mesmo padrão das 4 views existentes,
-- vw_processos_financeiro / vw_gecope_revisao_*): roda com o privilégio de
-- quem consulta. gecope_ia_readonly já tem GRANT SELECT nas tabelas-fonte
-- (escopo-dados.md); falta só o GRANT explícito nas views novas (abaixo).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- vw_assistente_obra_completa — uma linha por obra (id_obra)
-- ----------------------------------------------------------------------------
create or replace view public.vw_assistente_obra_completa
with (security_invoker = true) as
select
  ce.id_obra,
  ce.codigo_obra,
  ce.id_contrato,
  ce.nr_contrato_sop,
  ce.descricao_obra,
  ce.contratada,
  ce.contratante,
  ce.municipio,
  ce.distrito_operacional,
  ce.status_obra,
  ce.status_contrato,
  ce.valor_original,
  ce.total_aditivo,
  ce.valor_atual,
  ce.prazo_execucao,
  ce.dias_aditivado,
  ce.dias_paralisado,
  ce.data_assinatura,
  ce.data_fim_previsto,
  ce.data_fim_vigencia_contrato,
  fc.gestor_nome,
  fc.total_medido,
  fc.saldo_contrato,
  fc.percentual_aditivo,
  fc.percentual_total_medido,
  fc.dias_a_vencer,
  fis.fiscais,
  fis.fiscais_matriculas,
  proc.processos_total,
  proc.processos_em_tramitacao,
  proc.processos_numeros
from contratos_edificacao ce
left join ficha_contrato fc
  on fc.id_contrato = ce.id_contrato
left join lateral (
  select
    string_agg(distinct cf.nome_completo, ', ') as fiscais,
    string_agg(distinct cf.matricula, ', ')      as fiscais_matriculas
  from comissao_fiscalizacao cf
  where cf.id_obra = ce.id_obra and cf.tipo = 'Fiscal'
) fis on true
left join lateral (
  select
    count(*)::int as processos_total,
    count(*) filter (
      where p.status not in ('APROVADO', 'ARQUIVADO', 'EXCLUÍDO')
    )::int as processos_em_tramitacao,
    string_agg(p.processo, ', ') as processos_numeros
  from processos p
  where p.codigo_obra = ce.codigo_obra
    and p.data_exclusao is null
) proc on true;

comment on view public.vw_assistente_obra_completa is
  'F4 (assistente): uma linha por obra — contrato + ficha financeira + fiscal(is) '
  '+ resumo de processos de replanilhamento, sem risco de fan-out (ver cabeçalho '
  'de sql/assistente/f4_views.sql para as cardinalidades conferidas).';

-- ----------------------------------------------------------------------------
-- vw_assistente_processo_completo — uma linha por processo (processos.id)
-- ----------------------------------------------------------------------------
create or replace view public.vw_assistente_processo_completo
with (security_invoker = true) as
select
  p.id,
  p.processo,
  p.status,
  (p.status not in ('APROVADO', 'ARQUIVADO', 'EXCLUÍDO')) as em_tramitacao,
  p.tipo,
  p.descricao,
  p.fiscal,
  p.fiscal_matricula,
  p.analista,
  p.contratante,
  p.contratada,
  p.codigo_obra,
  p.distrito_operacional,
  p.municipio,
  p.data_abertura,
  p.data_recebimento,
  p.data_compromisso_fiscal,
  p.data_aprovacao_gecope,
  p.data_devolucao_correcoes,
  p.acresc_fiscal,
  p.supress_fiscal,
  p.reperc_fiscal,
  p.acresc_gecope,
  p.supress_gecope,
  p.reperc_gecope,
  (coalesce(p.reperc_gecope, 0) - coalesce(p.reperc_fiscal, 0)) as delta_reperc,
  p.prioritario,
  ce.descricao_obra   as obra_descricao,
  ce.status_obra      as obra_status,
  ce.nr_contrato_sop  as obra_nr_contrato_sop,
  ce.valor_atual      as obra_valor_atual
from processos p
left join contratos_edificacao ce
  on ce.codigo_obra = p.codigo_obra
where p.data_exclusao is null;

comment on view public.vw_assistente_processo_completo is
  'F4 (assistente): uma linha por processo de replanilhamento/aditivo — '
  'todos os campos de negócio de processos + contexto da obra vinculada '
  'quando existir (maioria não tem ainda — ver cabeçalho do arquivo).';

-- ----------------------------------------------------------------------------
-- Grants — mesma role de leitura do assistente, sem tocar em anon/authenticated
-- ----------------------------------------------------------------------------
grant select on public.vw_assistente_obra_completa to gecope_ia_readonly;
grant select on public.vw_assistente_processo_completo to gecope_ia_readonly;

commit;

-- ============================================================================
-- Bloco de verificação (rodar manualmente após aplicar, não faz parte da
-- migração) — espelha a tabela "Como verificar a F4" de
-- docs/assistente/fase-4-views.md
-- ============================================================================
-- A: select count(*) from vw_assistente_obra_completa;                       -- 352
-- B: select count(*) from vw_assistente_obra_completa where fiscais is null; -- 72
-- G: select count(*) from vw_assistente_processo_completo;                  -- = processos com data_exclusao null
-- H: select count(*) from vw_assistente_processo_completo where obra_descricao is null; -- ~352
-- J: select codigo_obra, processos_total from vw_assistente_obra_completa where processos_total > 1;

-- ============================================================================
-- ROLLBACK (se necessário)
-- ============================================================================
-- begin;
-- drop view if exists public.vw_assistente_obra_completa;
-- drop view if exists public.vw_assistente_processo_completo;
-- commit;
