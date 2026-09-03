-- ============================================================================
-- F2 — Núcleo determinístico do Assistente: corrige o bug do LIMIT duplicado
-- ============================================================================
-- Projeto: qexdnxqmiaarzwwwrcor (PRODUÇÃO). Aplicar no SQL Editor. Idempotente.
-- Depende da F1 já aplicada (sql/assistente/f1_seguranca.sql).
--
-- Bug (diagnóstico da F0, confirmado ao vivo na F1):
--   O guard 'if sql_consulta !~* ''\blimit\s+\d+'' then ... || '' limit 200'''
--   NUNCA casa — no regex do Postgres '\b' é o caractere BACKSPACE, borda de
--   palavra é '\y'. Então ' limit 200' era anexado SEMPRE. Com o schema_prompt
--   mandando o modelo incluir LIMIT, o SQL virava '... limit 200 limit 200'
--   -> ERRO 42601 'syntax error at or near "limit"'.
--
-- Correção desta migração (só o núcleo determinístico; segurança é F1, intocada):
--   1. '\b' -> '\y' no guard de LIMIT: agora DETECTA um LIMIT existente e NÃO
--      anexa outro.
--   2. LIMIT externo fixo de 500 no wrapper — cap absoluto, independente do que
--      o modelo escreva (o schema_prompt passou a mandar NÃO incluir LIMIT).
--   3. Aceita 'with' (CTE) no início, além de 'select' — o modelo às vezes usa
--      CTE para agregações; o blocklist de comandos + timeout contêm.
--   4. SET statement_timeout = 15s na função — evita consulta que trava (CTE
--      recursiva, produto cartesiano) segurar a Edge Function.
--   Guardas de segurança da F1 (comentário/aspas, schema fora de public, pg_*,
--   ::reg*, identidade, ALLOWLIST de funções) — reproduzidas SEM alteração.
-- ============================================================================

begin;

create or replace function public.executar_consulta_ia(sql_consulta text)
returns setof json
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '15s'   -- F2
as $function$
declare
  funcoes_ok text[] := array[
    'select','from','where','and','or','not','in','exists','on','over','filter',
    'values','case','when','by','all','any','some','using','as','into','distinct',
    'order','group','having','limit','offset','union','intersect','except','join',
    'cross','inner','left','right','full','outer','natural','lateral','within',
    'returning','partition','rows','range','between','ilike','like','similar','with',
    'count','sum','avg','min','max','stddev','stddev_pop','stddev_samp','variance',
    'var_pop','var_samp','corr','mode','percentile_cont','percentile_disc',
    'row_number','rank','dense_rank','percent_rank','cume_dist','ntile','lag','lead',
    'first_value','last_value','nth_value','bool_and','bool_or','every',
    'string_agg','array_agg','json_agg','jsonb_agg',
    'round','trunc','ceil','ceiling','floor','abs','sign','mod','power','sqrt','div',
    'greatest','least',
    'lower','upper','initcap','trim','btrim','ltrim','rtrim','length','char_length',
    'character_length','octet_length','substr','substring','lpad','rpad','position',
    'strpos','replace','translate','concat','concat_ws','format','split_part','starts_with',
    'reverse','repeat','overlay','md5','encode','decode','chr','ascii','left','right',
    'string_to_array','array_to_string','array_length','cardinality','unnest',
    'regexp_replace','regexp_match','regexp_matches','regexp_count','regexp_split_to_array',
    'to_char','to_date','to_number','to_timestamp','date_trunc','date_part','date_bin',
    'extract','age','now','current_date','current_time','current_timestamp','localtime',
    'localtimestamp','make_date','make_timestamp','make_interval','justify_days',
    'justify_hours','justify_interval',
    'date','time','timestamp','interval','numeric','int','int4','int8','bigint','integer',
    'text','varchar','bool','boolean','real','float','double',
    'exp','ln','log','width_bucket',
    'to_json','to_jsonb','json_build_object','jsonb_build_object','row_to_json',
    'json_object_agg','jsonb_object_agg',
    'cast','coalesce','nullif','nvl'
  ];
  fn_proibidas text;
begin
  sql_consulta := regexp_replace(trim(sql_consulta), ';\s*$', '');

  -- F1: rejeita comentário SQL e identificador entre aspas.
  if sql_consulta ~ '/\*' or sql_consulta ~ '\*/' or sql_consulta ~ '--' or sql_consulta ~ '"' then
    raise exception 'Comentário SQL ou identificador entre aspas não é permitido na consulta';
  end if;

  -- F2: aceita 'select' ou 'with' (CTE) no início.
  if sql_consulta !~* '^\s*(select|with)\s' then
    raise exception 'Apenas consultas SELECT (ou WITH ... SELECT) são permitidas';
  end if;

  -- F1: blocklist de comandos (\y = borda de palavra).
  if sql_consulta ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create)\y' then
    raise exception 'Comando não permitido detectado na consulta';
  end if;

  if sql_consulta ~* ';\s*\S' then
    raise exception 'Apenas uma instrução por consulta é permitida';
  end if;

  -- F1: schema fora de 'public'.
  if sql_consulta ~* '\y(net|cron|extensions|auth|storage|vault|graphql|graphql_public|realtime|pgsodium|pgbouncer|pg_temp|pg_toast|information_schema|supabase_migrations|supabase_functions|_analytics|_realtime)\s*\.' then
    raise exception 'Referência a schema fora de public não é permitida';
  end if;

  -- F1: catálogo do sistema.
  if sql_consulta ~* '\ypg_[a-z0-9_]+' then
    raise exception 'Referência a catálogo do sistema não é permitida';
  end if;

  -- F1 (R4): cast ::reg*.
  if sql_consulta ~* '::\s*reg[a-z]+' or sql_consulta ~* '\yreg(class|role|namespace|proc|procedure|type|oper|operator|config|dictionary)\y' then
    raise exception 'Cast para tipo de catálogo (reg*) não é permitido';
  end if;

  -- F1 (R4): identidade da sessão.
  if sql_consulta ~* '\y(current_catalog|current_role|current_user|current_schema|session_user|system_user)\y' then
    raise exception 'Referência a identidade da sessão não é permitida';
  end if;

  -- F1: ALLOWLIST de chamadas de função (default-deny).
  select string_agg(distinct g[1], ', ')
    into fn_proibidas
    from regexp_matches(lower(sql_consulta), '([a-z_][a-z0-9_]+)\s*\(', 'g') as m(g)
    where g[1] <> all (funcoes_ok);
  if fn_proibidas is not null then
    raise exception 'Função não permitida na consulta: %', fn_proibidas;
  end if;

  -- F2: '\y' (era '\b' = backspace, nunca casava). Só anexa LIMIT se NÃO houver.
  if sql_consulta !~* '\ylimit\s+\d+' then
    sql_consulta := sql_consulta || ' limit 200';
  end if;

  -- F2: cap externo fixo de 500 linhas, independente do LIMIT interno.
  return query execute format('select row_to_json(t) from (%s) t limit 500', sql_consulta);
end;
$function$;

revoke execute on function public.executar_consulta_ia(text) from public;
grant  execute on function public.executar_consulta_ia(text) to service_role;

commit;

-- ============================================================================
-- VERIFICAÇÃO (rodar separado)
-- ============================================================================
-- A) LIMIT explícito NÃO quebra mais (era 42601):
-- select * from executar_consulta_ia($$select descricao_obra from contratos_edificacao limit 3$$);   -- 3 linhas
-- select * from executar_consulta_ia($$select codigo_obra from processos limit 1000$$);              -- <= 500 (cap externo)
-- B) sem LIMIT: função injeta 200:
-- select count(*) from executar_consulta_ia($$select descricao_obra from contratos_edificacao$$);    -- 200
-- C) CTE:
-- select * from executar_consulta_ia($$with x as (select contratada, count(*) c from contratos_edificacao group by 1) select * from x order by c desc$$);
-- D) segurança da F1 intacta (devem ERRAR):
-- select * from executar_consulta_ia($$select schema_to_xml('net',true,false,'')$$);                 -- "Função não permitida"
-- select * from executar_consulta_ia($$select 1 from net._http_response$$);                          -- "schema fora de public"
-- E) timeout:
-- select * from executar_consulta_ia($$with recursive r(n) as (select 1 union all select n+1 from r) select n from r$$);  -- erro de timeout em ~15s
