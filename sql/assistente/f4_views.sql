-- ============================================================================
-- F4 — Views largas para Q&A do Assistente de Dados
-- Projeto: qexdnxqmiaarzwwwrcor (PRODUÇÃO). Aplicar manualmente no SQL Editor.
-- Idempotente (create or replace view). Transacional.
-- ============================================================================
-- Objetivo: dar ao caminho LLM (e à F5/F6) uma visão pronta, sem JOIN manual,
-- de obra+contrato+ficha+fiscal+processos — evitando o fan-out que o
-- rev-correcao encontrou na revisão da F3 (id_contrato não é a chave de
-- contratos_edificacao; um id_contrato pode aparecer em até 14 obras).
--
-- Cardinalidades confirmadas em 04/09/2026 (qexdnxqmiaarzwwwrcor), antes de
-- desenhar as views, e reconferidas de forma independente pelo rev-correcao:
--   contratos_edificacao.id_contrato -> ficha_contrato.id_contrato   : 1:1 (máx 1)
--   contratos_edificacao.id_obra -> comissao_fiscalizacao (Fiscal)   : 1:até 2 (9 grupos com 2, nenhum >2)
--   72 obras sem nenhum fiscal cadastrado
--   contratos_edificacao.codigo_obra   : único E not null (constraint de banco —
--     o LEFT JOIN por codigo_obra em vw_assistente_processo_completo é seguro
--     de forma permanente, não só coincidência de dados atuais)
--   processos.codigo_obra -> contratos_edificacao.codigo_obra       : 352/427 processos
--     têm codigo_obra NULO (não vinculados a obra ainda); 3 apontam para um
--     codigo_obra que não existe mais; só 72 têm vínculo válido
--   processos por codigo_obra (quando não-nulo)                     : máx 2 (3 grupos)
--
-- Duas views (não uma) por causa disso: juntar processos na view de obra via
-- LEFT JOIN esconderia os 352 processos sem vínculo de qualquer pergunta feita
-- a partir da view de obra.
--
-- Convenção de nome: prefixo vw_assistente_* para views criadas por esta
-- iniciativa (domínio "Q&A do assistente"), distinto de vw_gecope_* (domínio
-- "revisão GECOPE x fiscal") e vw_processos_financeiro (painel financeiro
-- pré-existente). Registrado aqui e em escopo-dados.md (rev-aderencia, F4).
--
-- Ambas security_invoker = true (mesmo padrão das 4 views existentes,
-- vw_processos_financeiro / vw_gecope_revisao_*): roda com o privilégio de
-- quem consulta. gecope_ia_readonly já tem GRANT SELECT nas tabelas-fonte
-- (escopo-dados.md); falta só o GRANT explícito nas views novas (abaixo).
-- Nota de segurança (rev-seguranca, F4): o schema public tem
-- ALTER DEFAULT PRIVILEGES concedendo SELECT a anon/authenticated em objetos
-- NOVOS por padrão (pré-existente, não introduzido por esta migração — as 4
-- views antigas têm o mesmo). O gate real de acesso é a RLS das tabelas-fonte,
-- não esse GRANT de catálogo: testado ao vivo (SET ROLE anon) e o resultado é
-- idêntico ao de consultar as tabelas-fonte direto como anon (0 linhas extras
-- expostas). Ver escopo-dados.md, seção "Como o escopo é imposto".
--
-- Filtro de exclusão: usa `excluido_por is null`, mesma coluna que as views
-- vw_gecope_revisao_* já usam (não `data_exclusao is null`, que também
-- existe na tabela e é 100% consistente com `excluido_por` hoje, mas diverge
-- da convenção já estabelecida — FU-1 do rev-correcao).
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
-- FU bloqueante do rev-correcao (F4, rodada 1): fiscais/fiscais_matriculas
-- eram dois `string_agg(distinct ...)` INDEPENDENTES, cada um ordenado pelo
-- próprio valor — nome e matrícula podiam sair emparelhados TROCADOS quando
-- a obra tinha 2 fiscais (confirmado em 7 das 9 obras reais com 2 fiscais).
-- Corrigido: agrega sobre UM subselect já deduplicado (nome+matrícula juntos
-- na mesma linha), ambos string_agg ordenados pela MESMA chave — nome e
-- matrícula nunca mais se separam. Reconferido nas 9 obras reais: 9/9 ok.
left join lateral (
  select
    string_agg(x.nome_completo, ', ' order by x.nome_completo) as fiscais,
    string_agg(x.matricula, ', ' order by x.nome_completo)      as fiscais_matriculas
  from (
    select distinct cf.nome_completo, cf.matricula
    from comissao_fiscalizacao cf
    where cf.id_obra = ce.id_obra and cf.tipo = 'Fiscal'
  ) x
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
    and p.excluido_por is null
) proc on true;

comment on view public.vw_assistente_obra_completa is
  'F4 (assistente): uma linha por obra — contrato + ficha financeira + fiscal(is) + resumo de processos de replanilhamento, sem risco de fan-out. Pareamento fiscal/matrícula corrigido na rodada 2 (rev-correcao).';

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
where p.excluido_por is null;

comment on view public.vw_assistente_processo_completo is
  'F4 (assistente): uma linha por processo de replanilhamento/aditivo — todos os campos de negócio + contexto da obra vinculada quando existir (maioria não tem ainda). Filtro de exclusão alinhado a excluido_por (FU-1 do rev-correcao).';

-- ----------------------------------------------------------------------------
-- Grants — mesma role de leitura do assistente, sem tocar em anon/authenticated
-- (ver nota de segurança no cabeçalho sobre ALTER DEFAULT PRIVILEGES)
-- ----------------------------------------------------------------------------
grant select on public.vw_assistente_obra_completa to gecope_ia_readonly;
grant select on public.vw_assistente_processo_completo to gecope_ia_readonly;

commit;

-- ============================================================================
-- Bloco de verificação (rodar manualmente após aplicar, não faz parte da
-- migração) — espelha a tabela "Como verificar a F4" de
-- docs/assistente/fase-4-views.md
-- ============================================================================
-- A: select count(*) from vw_assistente_obra_completa;                        -- 352
-- B: select count(*) from vw_assistente_obra_completa where fiscais is null;  -- 72
-- C: cruzar fiscais/fiscais_matriculas com comissao_fiscalizacao PARA AS 9
--    obras com 2 fiscais (não só 1 exemplo — foi o que deixou o bug passar
--    despercebido na rodada 1):
--      with fonte as (
--        select id_obra, string_agg(nome_completo||'=>'||matricula, ' | ' order by nome_completo) esperado
--        from comissao_fiscalizacao where tipo='Fiscal' group by id_obra having count(*) > 1
--      )
--      select v.id_obra, f.esperado, v.fiscais, v.fiscais_matriculas
--      from vw_assistente_obra_completa v join fonte f using (id_obra);
--    -- conferir cada linha à mão: nome N-ésimo em `fiscais` deve ser a mesma
--    -- pessoa da matrícula N-ésima em `fiscais_matriculas`.
-- D: select id_contrato, count(*) from vw_assistente_obra_completa group by id_contrato order by 2 desc limit 1; -- 14, não 14×14
-- E: select has_table_privilege('gecope_ia_readonly', 'public.vw_assistente_obra_completa', 'SELECT'),
--           has_table_privilege('gecope_ia_readonly', 'public.vw_assistente_processo_completo', 'SELECT'); -- true, true
-- F: select * from executar_consulta_ia('select count(*) as n from vw_assistente_obra_completa'); -- {"n":352}
-- G: select count(*) from vw_assistente_processo_completo;                    -- = processos com excluido_por null
-- H: select count(*) from vw_assistente_processo_completo where obra_descricao is null; -- ~344
-- J: select codigo_obra, processos_total from vw_assistente_obra_completa where processos_total > 1; -- 3 linhas

-- ============================================================================
-- ROLLBACK (se necessário)
-- ============================================================================
-- begin;
-- drop view if exists public.vw_assistente_obra_completa;
-- drop view if exists public.vw_assistente_processo_completo;
-- commit;
