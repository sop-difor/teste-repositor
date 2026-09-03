-- Script: add_leitura_comissao_fiscalizacao_authenticated.sql
-- Objetivo: permitir que usuários autenticados (admin/gerente/fiscal) leiam
-- public.comissao_fiscalizacao, mesma regra já aplicada em
-- public.contratos_edificacao via contratos_edificacao_pode_ler().
--
-- Sem essa policy, o vínculo de Processos a Obras (busca por Código da Obra
-- em NOVO PROCESSO / Gerenciar Processo, ver buscarObraPorCodigo em
-- modules/processos/processos.js) consegue ler contratos_edificacao (que já
-- tem policy para authenticated) mas comissao_fiscalizacao só tinha policy de
-- leitura para o role anon — usado pela página pública Mapa de Obras
-- (assets/js/mapa-obras.js), que roda sem login. Resultado: a consulta a
-- comissao_fiscalizacao volta vazia (RLS filtra silenciosamente, sem erro) e
-- o campo Fiscal Responsável nunca é sugerido automaticamente.
--
-- Aditivo e não-destrutivo: cria uma nova policy, não altera a existente
-- ("leitura publica comissao", role anon).
--
-- Idempotente: o Postgres não tem CREATE POLICY IF NOT EXISTS, então
-- fazemos DROP POLICY IF EXISTS antes do CREATE. Assim o script pode ser
-- reexecutado sem o erro 42710 ("policy ... already exists") e sempre
-- garante a definição abaixo.

BEGIN;

DROP POLICY IF EXISTS "leitura autenticada comissao_fiscalizacao"
  ON public.comissao_fiscalizacao;

CREATE POLICY "leitura autenticada comissao_fiscalizacao"
  ON public.comissao_fiscalizacao
  FOR SELECT
  TO authenticated
  USING (contratos_edificacao_pode_ler());

COMMIT;
