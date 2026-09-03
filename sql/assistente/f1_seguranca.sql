-- ============================================================================
-- F1 — Blindagem de segurança do Assistente de Dados do GECOPE
-- ============================================================================
-- Projeto: qexdnxqmiaarzwwwrcor (PRODUÇÃO)
-- Aplicar manualmente no SQL Editor do Supabase. Idempotente. Transacional.
-- Depois de aplicar: rodar o BLOCO DE VERIFICAÇÃO ao final (fora da transação).
--
-- Fecha 3 buracos confirmados na F0/F1:
--   A) executar_consulta_ia é executável por anon/authenticated via PostgREST
--      (/rest/v1/rpc/) — qualquer um com a anon key pública roda SELECT nas 13
--      tabelas sem passar pela Edge Function.
--   B) o blocklist de palavras-chave dentro de executar_consulta_ia usa '\b',
--      que no regex do Postgres é o caractere BACKSPACE, não borda de palavra
--      (borda é '\y'). Resultado: 'select 1; drop table x' NÃO é barrado pelo
--      blocklist (só pelas outras duas checagens — defesa em profundidade
--      furada). Verificado ao vivo.
--   C) gecope_ia_readonly tem USAGE em 'net' (herdado de PUBLIC) e
--      net._http_response / net.http_request_queue têm ALL para PUBLIC. Um
--      'select ... from net._http_response' (gerado ou induzido pelo texto da
--      pergunta) passaria — e essa tabela guarda corpos/headers de respostas
--      HTTP de saída (pg_net), que podem conter tokens. search_path='public'
--      cobre nomes NÃO qualificados; não cobre 'net.x' qualificado.
--
-- NÃO faz (é F2): corrigir o '\blimit\s+\d+' → o LIMIT duplicado é bug de
--   COMPORTAMENTO, tratado e testado na F2. Aqui o '\b' do guard de LIMIT fica
--   INTOCADO de propósito; só a camada de segurança (blocklist + schema) muda.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A) Tirar executar_consulta_ia do alcance direto de anon/authenticated.
--    Único caminho passa a ser a Edge Function gecope-assistant (service role).
--    service_role e o owner gecope_ia_readonly continuam podendo executar.
-- ----------------------------------------------------------------------------
revoke execute on function public.executar_consulta_ia(text) from anon;
revoke execute on function public.executar_consulta_ia(text) from authenticated;
revoke execute on function public.executar_consulta_ia(text) from public;

-- ----------------------------------------------------------------------------
-- B) + C) Recriar a função com:
--    - blocklist de palavras-chave com '\y' (borda de palavra de verdade);
--    - guarda nova: proíbe referência explícita a qualquer schema fora de
--      'public' (net, cron, extensions, auth, storage, vault, pg_catalog, ...);
--    - guard de LIMIT preservado LITERALMENTE (o '\b' continua — correção é F2).
-- ----------------------------------------------------------------------------
create or replace function public.executar_consulta_ia(sql_consulta text)
returns setof json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- remove um ; final (e espaços em volta), se houver
  sql_consulta := regexp_replace(trim(sql_consulta), ';\s*$', '');

  if sql_consulta !~* '^\s*select\s' then
    raise exception 'Apenas consultas SELECT são permitidas';
  end if;

  -- F1: '\y' = borda de palavra (ANTES era '\b' = backspace, nunca casava).
  -- Mesma lista de palavras da versão original — só o operador de borda muda.
  if sql_consulta ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create)\y' then
    raise exception 'Comando não permitido detectado na consulta';
  end if;

  if sql_consulta ~* ';\s*\S' then
    raise exception 'Apenas uma instrução por consulta é permitida';
  end if;

  -- F1: nenhuma referência a schema fora de 'public'. Cobre 'net.x', "net" . x,
  -- net.x, extensions.x etc. A role tem USAGE em 'net' herdado de PUBLIC.
  if sql_consulta ~* '\y(net|cron|extensions|auth|storage|vault|graphql|graphql_public|realtime|pgsodium|pgbouncer|pg_catalog|pg_temp|information_schema|supabase_migrations|supabase_functions|_analytics|_realtime)\s*\.' then
    raise exception 'Referência a schema fora de public não é permitida';
  end if;

  -- F1: também barra o prefixo pg_ genérico (pg_class, pg_stat_*, pg_shadow...)
  if sql_consulta ~* '\ypg_[a-z0-9_]+\s*\.' then
    raise exception 'Referência a catálogo do sistema não é permitida';
  end if;

  -- >>> F2 corrige o '\b' abaixo (→ '\y') e o caso de LIMIT pré-existente. <<<
  -- >>> NÃO alterar nesta fase: a F2 testa a mudança de comportamento.      <<<
  if sql_consulta !~* '\blimit\s+\d+' then
    sql_consulta := sql_consulta || ' limit 200';
  end if;

  return query execute format('select row_to_json(t) from (%s) t', sql_consulta);
end;
$function$;

-- garante que o EXECUTE segue só com quem deve
revoke execute on function public.executar_consulta_ia(text) from public;
grant execute on function public.executar_consulta_ia(text) to service_role;

commit;

-- ============================================================================
-- OPCIONAL — só rodar após conferir que nada legítimo depende do acesso de
-- PUBLIC ao schema 'net'. Fecha o buraco C na origem (além da guarda da função).
-- anon/authenticated/service_role/postgres/supabase_functions_admin têm USAGE
-- PRÓPRIO em 'net' e NÃO são afetados. Só perde acesso quem dependia de PUBLIC
-- (ex.: a própria gecope_ia_readonly — que é o objetivo).
-- ============================================================================
-- revoke usage on schema net from public;
-- revoke all on net._http_response      from public;
-- revoke all on net.http_request_queue  from public;
-- revoke select on extensions.pg_stat_statements      from public;
-- revoke select on extensions.pg_stat_statements_info from public;

-- ============================================================================
-- BLOCO DE VERIFICAÇÃO (rodar separado, fora da transação)
-- ============================================================================
-- 1) EXECUTE só com service_role + owner:
-- select
--   has_function_privilege('anon',          'public.executar_consulta_ia(text)','execute') as anon,          -- esperado: false
--   has_function_privilege('authenticated', 'public.executar_consulta_ia(text)','execute') as authenticated, -- esperado: false
--   has_function_privilege('service_role',  'public.executar_consulta_ia(text)','execute') as service_role;  -- esperado: true
--
-- 2) blocklist agora funciona:
-- select ('select 1; drop table x' ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create)\y') as deve_ser_true;
--
-- 3) guarda de schema funciona e não gera falso-positivo:
-- select * from executar_consulta_ia('select 1 from net._http_response');                    -- esperado: ERRO "schema fora de public"
-- select * from executar_consulta_ia('select count(*) from contratos_edificacao');            -- esperado: retorna número
--
-- 4) alcance da role (deve listar só os 13 objetos de public; net/cron/extensions
--    podem aparecer com has_table_privilege=true mas SEM schema USAGE utilizável):
-- select has_schema_privilege('gecope_ia_readonly','net','usage')        as net_usage,   -- ainda true se o OPCIONAL não foi rodado
--        has_schema_privilege('gecope_ia_readonly','public','usage')     as public_usage;
