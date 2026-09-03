-- =====================================================================================
-- LOCALIZAR ÓRFÃOS PARA CADASTRO MANUAL (2026-08-14)
-- =====================================================================================
-- Contexto: sql/fix_app_users_email_mismatch.sql (consulta 1) encontrou 6 contas em
-- auth.users sem NENHUM perfil correspondente em public.app_users. A consulta 2 desse
-- mesmo script (candidatos a reparo por UPDATE) voltou vazia — ou seja, não há nada para
-- "corrigir", só perfis que precisam ser CRIADOS do zero pelo admin.
--
-- Este script busca nome/matrícula na notificação de cadastro original (app_notifications)
-- para cada uma dessas 6 contas, facilitando o cadastro manual via "Novo Usuário" no
-- painel Admin. Só leitura — não altera nada.
-- =====================================================================================

SELECT
  au.id                                   AS auth_id,
  au.email                                AS auth_email,
  au.created_at                           AS auth_criado_em,
  n.payload::json ->> 'matricula'         AS matricula_da_notificacao,
  n.payload::json ->> 'nome'              AS nome_da_notificacao,
  n.created_at                            AS notificacao_criada_em
FROM auth.users au
LEFT JOIN public.app_users pu
  ON lower(pu.email) = lower(au.email)
LEFT JOIN public.app_notifications n
  ON n.type = 'new_user_request'
 AND lower(n.payload::json ->> 'email') = lower(au.email)
WHERE pu.email IS NULL
ORDER BY au.created_at DESC;

-- =====================================================================================
-- COMO USAR O RESULTADO:
-- - Se "nome_da_notificacao"/"matricula_da_notificacao" vierem preenchidos: use esses
--   dados para cadastrar a pessoa manualmente em Admin > Novo Usuário, com o e-mail
--   exatamente igual a "auth_email" (é o que está gravado em auth.users — tem que bater
--   com precisão para o login funcionar).
-- - Se vierem NULL (mais provável nas 4 contas "matricula@gecope.app" mais antigas): não
--   há notificação de cadastro correspondente a rastrear — provavelmente contas de teste
--   ou criadas antes desse fluxo de notificação existir. Cadastre manualmente só se
--   souber de outra forma quem é a pessoa (ex.: pela matrícula visível no próprio
--   auth_email); caso contrário, considere ignorar ou excluir a conta órfã no painel de
--   Authentication do Supabase, se confirmado que não corresponde a ninguém ativo.
-- =====================================================================================
