-- Script: fechar_acesso_publico_contratos.sql
-- Objetivo: módulo "Contratos" (Mapa de Obras) deixa de ser público (sem login) e
-- passa a exigir sessão do GECOPE. Regra final: qualquer usuário autenticado com
-- papel válido (admin, gerente, fiscal, externo) pode VISUALIZAR/CONSULTAR; só
-- Admin pode gravar/excluir.
--
-- Contexto (achado durante o plano de permissões por papel, Fase 2): as 5 tabelas
-- que assets/js/mapa-obras.js lê tinham uma policy "leitura publica <tabela>"
-- (role anon, USING true) — qualquer pessoa na internet, sem login nenhum,
-- conseguia ler os dados direto pela API REST do Supabase. A própria página
-- confirma isso: ela nunca manda o token do usuário logado, só a chave anônima
-- fixa (config.js) como Bearer.
--
-- O que este script faz:
--   1. Amplia contratos_edificacao_pode_ler() para incluir 'externo' (antes só
--      admin/gerente/fiscal) — essa função já governa leitura autenticada de
--      contratos_edificacao e comissao_fiscalizacao, usada também pelo vínculo
--      Processos<->Obras (buscarObraPorCodigo em modules/processos/processos.js).
--      Ampliar para incluir externo é seguro: só adiciona um papel à leitura,
--      não mexe em quem já podia ler.
--   2. Redefine contratos_edificacao_pode_escrever() para ser estritamente
--      admin-only (as 3 policies de INSERT/UPDATE/DELETE em contratos_edificacao
--      já usam essa função — nenhuma tela do GECOPE hoje grava nessa tabela,
--      então este passo não deveria afetar nenhum fluxo em uso, é só travar a
--      porta pra qualquer gravação futura/externa).
--   3. Cria a policy de leitura autenticada que faltava em aditivos_contrato,
--      ficha_contrato e medicoes (hoje só tinham a policy pública) — sem isso,
--      ao remover o acesso anônimo, ninguém (nem Admin) conseguiria mais ler
--      essas 3 tabelas pela sessão normal.
--   4. Remove as 5 policies "leitura publica <tabela>" (role anon) — a trava de
--      verdade contra acesso sem login.
--
-- Pré-requisito de front-end: assets/js/mapa-obras.js precisa passar a mandar
-- o token de sessão do usuário logado (Authorization: Bearer <access_token da
-- sessão>) em vez da chave anônima fixa — sem essa troca, o front simplesmente
-- para de conseguir ler qualquer coisa depois deste script (a chave anônima
-- não representa mais ninguém autenticado).
--
-- Idempotente: todo CREATE OR REPLACE FUNCTION e DROP POLICY IF EXISTS pode
-- rodar de novo sem erro.

BEGIN;

-- 1. Amplia a leitura para incluir 'externo'
CREATE OR REPLACE FUNCTION public.contratos_edificacao_pode_ler()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role in ('admin','gerente','fiscal','externo'));
$function$;

-- 2. Escrita (insert/update/delete em contratos_edificacao) passa a ser só Admin
CREATE OR REPLACE FUNCTION public.contratos_edificacao_pode_escrever()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email') and u.role = 'admin');
$function$;

-- 3. Policies de leitura autenticada que faltavam (mesma regra de
--    contratos_edificacao/comissao_fiscalizacao, via a função acima)
DROP POLICY IF EXISTS "leitura autenticada aditivos_contrato" ON public.aditivos_contrato;
CREATE POLICY "leitura autenticada aditivos_contrato"
  ON public.aditivos_contrato
  FOR SELECT
  TO authenticated
  USING (contratos_edificacao_pode_ler());

DROP POLICY IF EXISTS "leitura autenticada ficha_contrato" ON public.ficha_contrato;
CREATE POLICY "leitura autenticada ficha_contrato"
  ON public.ficha_contrato
  FOR SELECT
  TO authenticated
  USING (contratos_edificacao_pode_ler());

DROP POLICY IF EXISTS "leitura autenticada medicoes" ON public.medicoes;
CREATE POLICY "leitura autenticada medicoes"
  ON public.medicoes
  FOR SELECT
  TO authenticated
  USING (contratos_edificacao_pode_ler());

-- 4. Remove o acesso público (anon) — a trava de verdade
DROP POLICY IF EXISTS "leitura publica contratos_edificacao" ON public.contratos_edificacao;
DROP POLICY IF EXISTS "leitura publica comissao" ON public.comissao_fiscalizacao;
DROP POLICY IF EXISTS "leitura publica aditivos_contrato" ON public.aditivos_contrato;
DROP POLICY IF EXISTS "leitura publica ficha_contrato" ON public.ficha_contrato;
DROP POLICY IF EXISTS "leitura publica medicoes" ON public.medicoes;

COMMIT;
