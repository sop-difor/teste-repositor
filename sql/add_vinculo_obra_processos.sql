-- Script: add_vinculo_obra_processos.sql
-- Objetivo: permitir vincular um Processo (public.processos) ao contrato/obra correspondente
-- em public.contratos_edificacao (base SIGSOP), para autopreencher Descrição do Objeto,
-- Fiscal, Contratante, Contratada, Distrito Operacional e Município no cadastro.
--
-- Aditivo e não-destrutivo: todas as colunas são nullable, sem NOT NULL e sem FK rígida
-- (o sync do SIGSOP via sigsop_contratos.py pode não cobrir 100% das obras, ou estar
-- desatualizado no momento do cadastro). Processos já existentes não são afetados —
-- simplesmente ficam com essas 3 colunas em branco até serem vinculados manualmente
-- (ver botão "Vincular/Atualizar Obra" em Gerenciar Processo, restrito a admin).
--
-- Mesmo padrão de sql/add_processo_column.sql (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).

BEGIN;

ALTER TABLE IF EXISTS public.processos
  ADD COLUMN IF NOT EXISTS codigo_obra VARCHAR(50),
  ADD COLUMN IF NOT EXISTS distrito_operacional VARCHAR(100),
  ADD COLUMN IF NOT EXISTS municipio VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_processos_codigo_obra ON public.processos(codigo_obra);

COMMIT;
