-- Script: create_view_processos_financeiro.sql
-- Objetivo: Fornecer uma fonte única e reutilizável (view) com os processos que
-- devem entrar na análise financeira (Painel Financeiro), evitando que cada
-- relatório precise reimplementar a regra de negócio abaixo.
--
-- Regra de negócio:
--   - Processos com status APROVADO ou ARQUIVADO só entram quando já foram
--     efetivamente revisados pela GECOPE, ou seja, quando existem valores de
--     repercussão tanto da Fiscalização quanto da GECOPE
--     (reperc_fiscal <> 0 E reperc_gecope <> 0). A guarda é a mesma para os
--     dois status: um processo APROVADO com a GECOPE zerada (ex. campo não
--     salvo) não deve ser contabilizado como corte de 100% da repercussão
--     ("corte fantasma") que infla a economia relatada.
--
--   NOTA (melhoria futura, não implementada): usar reperc_gecope <> 0 como
--   prova de "foi revisado" descarta silenciosamente um processo em que a
--   GECOPE legitimamente zerou a repercussão (supressão total do aditivo).
--   O ideal é substituir esse proxy por um sinal explícito de revisão
--   concluída (coluna booleana revisado_gecope ou data_aprovacao_gecope
--   IS NOT NULL).
--
-- Coluna derivada "analise_aprofundada" (2026-09-01):
--   Nem todo processo do painel passa por análise aprofundada da GECOPE. Quando
--   um processo só tem supressão (sem acréscimo) e a GECOPE concorda com o valor
--   da Fiscalização, ele é tratado como "processo de supressão" — pass-through
--   administrativo, sem revisão de mérito. A análise aprofundada de fato ocorre
--   quando há acréscimo (fiscal ou identificado pela própria GECOPE) ou quando,
--   mesmo sendo só supressão, a GECOPE diverge do valor da Fiscalização (prova
--   de que houve avaliação). Essa coluna existe para que TAXA DE REVISÃO,
--   VARIAÇÃO MÉDIA, MEDIANA e CORTE MÉDIO ENTRE ALTERADOS no Painel Financeiro
--   possam ser calculados só sobre processos efetivamente analisados a fundo,
--   sem diluir esses indicadores com supressões puras concordadas. Os totais em
--   R$ do painel continuam somando todos os processos, independente desta coluna.
--   Tolerância de 0,01 (1 centavo) aplicada de forma simétrica nos três termos
--   (acresc_fiscal, acresc_gecope, diferença de supressão), igual ao padrão já
--   usado no restante do painel (financeiro.js), pra não deixar resíduo de
--   arredondamento/dado legado em acréscimo classificar um processo como
--   analisado quando na prática ele é uma supressão pura.
--
-- Uso: Cole este script no SQL Editor do projeto Supabase e execute.

create or replace view public.vw_processos_financeiro
with (security_invoker = true)
as
select
  p.*,
  (
    abs(coalesce(p.acresc_fiscal, 0)) > 0.01
    or abs(coalesce(p.acresc_gecope, 0)) > 0.01
    or abs(coalesce(p.supress_gecope, 0) - coalesce(p.supress_fiscal, 0)) > 0.01
  ) as analise_aprofundada
from public.processos p
where p.status in ('APROVADO', 'ARQUIVADO')
  and coalesce(p.reperc_fiscal, 0) <> 0
  and coalesce(p.reperc_gecope, 0) <> 0;

-- Garante que os papéis usados pelo cliente (anon/authenticated) consigam
-- consultar a view. Ajuste conforme as políticas de RLS já existentes em
-- "processos" (a view usa security_invoker, então as mesmas RLS se aplicam).
grant select on public.vw_processos_financeiro to anon, authenticated;
