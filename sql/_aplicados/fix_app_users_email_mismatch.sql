-- =====================================================================================
-- CORREÇÃO: e-mail divergente entre auth.users (Supabase Auth) e public.app_users
-- =====================================================================================
-- CONTEXTO: a Edge Function "approve-user" (fallback usado quando o cadastro não gerava
-- uma linha em app_users a tempo da aprovação) fabricava um e-mail "matricula@gecope.app"
-- em vez de usar o e-mail real do cadastro. Isso criava um perfil em app_users desconectado
-- da conta real em auth.users, e o usuário passava a "não ter acesso" mesmo aprovado.
-- O código-fonte já foi corrigido (não fabrica mais e-mail quando o real está disponível).
-- Este script serve para reparar os registros que já foram fabricados no passado.
--
-- Rode cada bloco NA ORDEM. Os blocos de UPDATE ficam comentados — revise o SELECT
-- correspondente antes de descomentar e executar.
-- =====================================================================================


-- 1) DIAGNÓSTICO — contas de autenticação sem perfil correspondente em app_users
--    (comparação sempre em minúsculas, pois o Auth grava o e-mail normalizado)
SELECT au.id AS auth_id, au.email AS auth_email, au.created_at
FROM auth.users au
LEFT JOIN public.app_users pu ON lower(pu.email) = lower(au.email)
WHERE pu.email IS NULL
ORDER BY au.created_at DESC;


-- 2) DIAGNÓSTICO — perfis em app_users com e-mail fabricado (matricula@gecope.app ou
--    ghost) que têm, na notificação de cadastro original, o e-mail real informado pelo
--    usuário. Esses são os candidatos a reparo.
SELECT
  pu.id            AS app_user_id,
  pu.matricula,
  pu.email         AS email_fabricado_atual,
  (n.payload::json ->> 'email') AS email_real_no_cadastro,
  n.created_at     AS solicitado_em
FROM public.app_users pu
JOIN public.app_notifications n
  ON n.type = 'new_user_request'
 AND (n.payload::json ->> 'matricula') = pu.matricula
WHERE (pu.email LIKE '%@gecope.app' OR pu.email LIKE '%@sop-ghost.internal')
  AND (n.payload::json ->> 'email') IS NOT NULL
  AND (n.payload::json ->> 'email') <> ''
  AND lower(n.payload::json ->> 'email') <> lower(pu.email)
ORDER BY n.created_at DESC;


-- 3) REPARO — aplica o e-mail real (normalizado) aos registros identificados no passo 2.
--    Revise a lista acima antes de descomentar e rodar.
-- UPDATE public.app_users pu
-- SET email = lower(trim(sub.email_real))
-- FROM (
--   SELECT DISTINCT ON (pu2.id)
--     pu2.id,
--     (n.payload::json ->> 'email') AS email_real
--   FROM public.app_users pu2
--   JOIN public.app_notifications n
--     ON n.type = 'new_user_request'
--    AND (n.payload::json ->> 'matricula') = pu2.matricula
--   WHERE (pu2.email LIKE '%@gecope.app' OR pu2.email LIKE '%@sop-ghost.internal')
--     AND (n.payload::json ->> 'email') IS NOT NULL
--     AND (n.payload::json ->> 'email') <> ''
--   ORDER BY pu2.id, n.created_at DESC
-- ) sub
-- WHERE pu.id = sub.id;


-- 4) LIMPEZA GERAL — normaliza (trim + minúsculas) todos os e-mails já existentes em
--    app_users, para ficar consistente com o padrão do Supabase Auth daqui pra frente.
--    Seguro de rodar mesmo que nada esteja divergente (idempotente).
-- UPDATE public.app_users
-- SET email = lower(trim(email))
-- WHERE email IS NOT NULL
--   AND email <> lower(trim(email));


-- 5) VERIFICAÇÃO FINAL — repita a consulta do passo 1 após os reparos; o ideal é que
--    volte vazia (ou só com contas legitimamente sem perfil ainda, ex.: pendentes reais).
-- SELECT au.id AS auth_id, au.email AS auth_email
-- FROM auth.users au
-- LEFT JOIN public.app_users pu ON lower(pu.email) = lower(au.email)
-- WHERE pu.email IS NULL;
