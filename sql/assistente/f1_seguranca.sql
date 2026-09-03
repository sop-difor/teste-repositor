-- ============================================================================
-- F1 — Blindagem de segurança do Assistente de Dados do GECOPE
-- ============================================================================
-- Projeto: qexdnxqmiaarzwwwrcor (PRODUÇÃO)
-- Aplicar manualmente no SQL Editor do Supabase. Idempotente. Transacional.
-- Depois de aplicar: rodar o BLOCO DE VERIFICAÇÃO ao final (fora da transação).
--
-- Corpo base de executar_consulta_ia: pg_get_functiondef da função em produção,
-- capturado em 2026-09-03. Únicos diffs intencionais desta migração:
--   * blocklist de comandos: '\b' -> '\y' (borda de palavra de verdade);
--   * REJEITA de saída qualquer SQL com comentário ('--', '/*', '*/') ou aspas
--     de identificador ('"') — normalizar por regex não é são (comentário
--     aninhado /*/**/*/ e '--' dentro de literal furam). SQL analítico do
--     modelo não usa nenhum dos três; o schema_prompt instrui isso;
--   * guarda nova: proíbe referência a schema fora de 'public' e a catálogo
--     do sistema (pg_*), qualificado ou não;
--   * guarda nova: proíbe dblink / current_setting / set_config / lo_import /
--     lo_export.
--   O guard de LIMIT ('\blimit\s+\d+') fica INTOCADO — o LIMIT duplicado é bug
--   de COMPORTAMENTO, corrigido e testado na F2.
--
-- Fecha os buracos A–G (ver docs/assistente/fase-1-seguranca.md). O buraco G
-- (RLS bloqueia a role de leitura → caminho LLM devolvia 0 linhas) foi achado
-- pelo rev-correcao durante a revisão da F1.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A) Tirar executar_consulta_ia do alcance direto de anon/authenticated.
--    Único caminho passa a ser a Edge Function gecope-assistant (service role).
-- ----------------------------------------------------------------------------
revoke execute on function public.executar_consulta_ia(text) from public;
revoke execute on function public.executar_consulta_ia(text) from anon;
revoke execute on function public.executar_consulta_ia(text) from authenticated;

-- ----------------------------------------------------------------------------
-- B) + C) Recriar a função com normalização + guardas robustas.
-- ----------------------------------------------------------------------------
create or replace function public.executar_consulta_ia(sql_consulta text)
returns setof json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  sql_consulta := regexp_replace(trim(sql_consulta), ';\s*$', '');

  -- F1: rejeita comentário SQL e identificador entre aspas ANTES de qualquer
  -- outra checagem. Normalizar (tirar comentário/aspas por regex) não é são —
  -- comentário aninhado ('/*/**/*/') e '--' dentro de literal furam. SQL
  -- analítico gerado pelo modelo não precisa de nenhum dos três; o schema_prompt
  -- instrui o modelo a não usá-los. As checagens seguintes rodam sobre um texto
  -- garantidamente sem comentário e sem aspas.
  if sql_consulta ~ '/\*' or sql_consulta ~ '\*/' or sql_consulta ~ '--' or sql_consulta ~ '"' then
    raise exception 'Comentário SQL ou identificador entre aspas não é permitido na consulta';
  end if;

  if sql_consulta !~* '^\s*select\s' then
    raise exception 'Apenas consultas SELECT são permitidas';
  end if;

  -- F1: '\y' = borda de palavra (ANTES era '\b' = backspace, nunca casava).
  if sql_consulta ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create)\y' then
    raise exception 'Comando não permitido detectado na consulta';
  end if;

  if sql_consulta ~* ';\s*\S' then
    raise exception 'Apenas uma instrução por consulta é permitida';
  end if;

  -- F1: nenhuma referência a schema fora de 'public'. gecope_ia_readonly tem
  -- USAGE em 'net' herdado de PUBLIC e net._http_response tem ALL para PUBLIC
  -- (pode guardar tokens de chamadas HTTP de saída do pg_net).
  if sql_consulta ~* '\y(net|cron|extensions|auth|storage|vault|graphql|graphql_public|realtime|pgsodium|pgbouncer|pg_temp|pg_toast|information_schema|supabase_migrations|supabase_functions|_analytics|_realtime)\s*\.' then
    raise exception 'Referência a schema fora de public não é permitida';
  end if;

  -- F1: nenhum identificador de catálogo do sistema (pg_class, pg_roles,
  -- pg_stat_activity, pg_read_file, pg_sleep, ...), qualificado ou não.
  if sql_consulta ~* '\ypg_[a-z0-9_]+' then
    raise exception 'Referência a catálogo do sistema não é permitida';
  end if;

  -- F1: funções de leitura de ambiente / ponte externa.
  if sql_consulta ~* '\y(dblink|current_setting|set_config|lo_import|lo_export)\y' then
    raise exception 'Função não permitida detectada na consulta';
  end if;

  -- >>> F2 corrige o '\b' abaixo (-> '\y') e o caso de LIMIT pré-existente. <<<
  -- >>> NÃO alterar nesta fase: a F2 testa a mudança de comportamento.      <<<
  if sql_consulta !~* '\blimit\s+\d+' then
    sql_consulta := sql_consulta || ' limit 200';
  end if;

  return query execute format('select row_to_json(t) from (%s) t', sql_consulta);
end;
$function$;

revoke execute on function public.executar_consulta_ia(text) from public;
grant  execute on function public.executar_consulta_ia(text) to service_role;

-- ----------------------------------------------------------------------------
-- C-origem) Best-effort: revogar o acesso de PUBLIC ao schema net e às tabelas
--    do pg_net. O concedente é 'supabase_admin' e o SQL Editor roda como
--    'postgres' (não superuser, não membro de supabase_admin), então isto
--    PODE falhar — não aborta a migração; a guarda da função acima é a
--    proteção efetiva. Se falhar e você quiser fechar na origem, abra chamado
--    no suporte Supabase pedindo:
--        REVOKE USAGE ON SCHEMA net FROM PUBLIC;
--        REVOKE ALL ON net._http_response, net.http_request_queue FROM PUBLIC;
--    (todos os papéis nomeados — anon, authenticated, service_role, postgres,
--     supabase_functions_admin — têm USAGE PRÓPRIO em net e NÃO são afetados.)
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    execute 'revoke usage on schema net from public';
    raise notice 'F1: revoke usage on schema net from public — OK';
  exception when others then
    raise notice 'F1: revoke usage on schema net from public FALHOU (%) — guarda da função cobre.', sqlerrm;
  end;
  begin
    execute 'revoke all on net._http_response, net.http_request_queue from public';
    raise notice 'F1: revoke all on net.* from public — OK';
  exception when others then
    raise notice 'F1: revoke all on net.* from public FALHOU (%) — guarda da função cobre.', sqlerrm;
  end;
end $$;

-- ----------------------------------------------------------------------------
-- G) Acesso de leitura da role à lista branca (buraco novo, achado do
--    rev-correcao). executar_consulta_ia roda como gecope_ia_readonly
--    (SECURITY DEFINER). As 9 tabelas do escopo têm RLS ligada com policies só
--    para anon/authenticated — a role NÃO tem policy, então RLS nega tudo:
--    'select count(*) from contratos_edificacao' devolvia 0 (tabela tem 352).
--    As 4 views são security_invoker=true → herdam o mesmo bloqueio.
--    Sem isto, TODA pergunta do caminho LLM responde "Nenhum resultado".
--
--    Correção: policy PERMISSIVE de SELECT, escopada a gecope_ia_readonly, uma
--    por tabela-base. Visível em pg_policies; não toca policies de outros
--    papéis (permissive = OR); as views resolvem via as tabelas-base.
--    (Alternativa mais curta, não adotada: ALTER ROLE gecope_ia_readonly
--     BYPASSRLS — menos auditável, atributo amplo no papel.)
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'processos','contratos_edificacao','aditivos_contrato','ficha_contrato',
    'medicoes','comissao_fiscalizacao','checklist_documentacao_aditivo',
    'curva_abc_versoes','curva_abc_itens'
  ] loop
    execute format('drop policy if exists ia_ro_select on public.%I', t);
    execute format(
      'create policy ia_ro_select on public.%I as permissive for select to gecope_ia_readonly using (true)', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- F) LGPD — consultas_ia_log guarda o texto da pergunta (pode conter nome de
--    fiscal/analista). Hoje só a RLS (1 policy, service_role) separa isso do
--    público, mas anon/authenticated ainda têm GRANTs de tabela. Fecha a folga.
-- ----------------------------------------------------------------------------
revoke all on table public.consultas_ia_log from anon;
revoke all on table public.consultas_ia_log from authenticated;
alter table public.consultas_ia_log force row level security;

commit;

-- ============================================================================
-- ROLLBACK (se precisar reverter tudo)
-- ============================================================================
-- begin;
--   grant execute on function public.executar_consulta_ia(text) to anon, authenticated;
--   -- reaplicar o corpo ANTERIOR da função (pg_get_functiondef salvo antes da F1);
--   grant select, insert, update, delete on table public.consultas_ia_log to anon, authenticated;
--   alter table public.consultas_ia_log no force row level security;
--   do $$ declare t text; begin
--     foreach t in array array['processos','contratos_edificacao','aditivos_contrato','ficha_contrato','medicoes','comissao_fiscalizacao','checklist_documentacao_aditivo','curva_abc_versoes','curva_abc_itens']
--     loop execute format('drop policy if exists ia_ro_select on public.%I', t); end loop; end $$;
-- commit;
-- A Edge Function reverte por redeploy da v12 (código em git no commit 782e86c).

-- ============================================================================
-- BLOCO DE VERIFICAÇÃO (rodar separado, fora da transação)
-- ============================================================================
-- 1) EXECUTE só com service_role + owner:
-- select
--   has_function_privilege('anon',          'public.executar_consulta_ia(text)','execute') as anon,          -- false
--   has_function_privilege('authenticated', 'public.executar_consulta_ia(text)','execute') as authenticated, -- false
--   has_function_privilege('service_role',  'public.executar_consulta_ia(text)','execute') as service_role;  -- true
--
-- 2) blocklist e guardas (todas devem ERRAR):
-- select * from executar_consulta_ia($$select 1 from net._http_response$$);
-- select * from executar_consulta_ia($$select 1 from "net"."_http_response"$$);
-- select * from executar_consulta_ia($$select 1 from net/**/._http_response$$);
-- select * from executar_consulta_ia($$select 1 from pg_roles$$);
-- select * from executar_consulta_ia($$select current_setting('is_superuser')$$);
-- select * from executar_consulta_ia($$select 1; drop table x$$);
--
-- 3) consulta legítima (deve RETORNAR o número real, > 0):
-- select * from executar_consulta_ia($$select count(*) from contratos_edificacao$$);  -- ~352, NÃO 0
-- select * from executar_consulta_ia($$select c.descricao_obra, f.saldo_contrato
--   from contratos_edificacao c join ficha_contrato f on f.id_contrato = c.id_contrato limit 5$$);
-- select * from executar_consulta_ia($$select count(*) from vw_processos_financeiro$$);  -- ~318, NÃO 0
--
-- 3b) buraco G — a role lê a lista branca (usar SET ROLE, não SET LOCAL —
--     SET LOCAL fora de transação é ignorado e roda como postgres/BYPASSRLS):
-- set role gecope_ia_readonly;
--   select count(*) from public.processos;             -- ~427 (NÃO 0)
--   select count(*) from public.medicoes;              -- ~2944 (NÃO 0)
--   select count(*) from public.vw_processos_financeiro; -- ~318 (NÃO 0)
-- reset role;
--
-- 4) LGPD:
-- select has_table_privilege('anon','public.consultas_ia_log','select') as anon_le;        -- false
-- select relforcerowsecurity from pg_class where relname = 'consultas_ia_log';              -- true
