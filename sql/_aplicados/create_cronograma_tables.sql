-- Migração: tabelas do módulo "Atividades" (cronograma.html)
-- Substitui o localStorage (gecope_analistas_v2 / gecope_tarefas_v2 / gecope_rotinas_v2)
-- por armazenamento compartilhado no Supabase.
--
-- Nomes prefixados com "cronograma_" para não colidir com a tabela existente
-- "app_atividades" (que é o log de atividades da home, um conceito diferente).
--
-- Uso: rode este arquivo inteiro no SQL Editor do Supabase (Dashboard > SQL Editor).

begin;

-- ── ANALISTAS ──────────────────────────────────────────────────────────────
create table if not exists cronograma_analistas (
  id         text primary key,           -- gerado no cliente (uid()), mantido como texto
  nome       text not null,
  matricula  text,
  cargo      text,
  created_at timestamptz not null default now()
);

-- ── TAREFAS ─────────────────────────────────────────────────────────────────
create table if not exists cronograma_tarefas (
  id            text primary key,
  analista_id   text references cronograma_analistas(id) on delete cascade,
  setor         text,                    -- 'GECOPE' | 'EXTERNO'
  processo      text,
  descricao     text,
  setor_nome    text,
  inicio        date,
  prazo         date,
  status        text,                    -- ativa | aguardando | paralisada | concluida
  obs           text,                    -- HTML (rich text) das observações
  prioridade    text,                    -- normal | alta | urgente
  ordem         integer,
  historico     jsonb not null default '[]'::jsonb,
  criado_em     timestamptz,
  atualizado_em timestamptz
);

create index if not exists idx_cronograma_tarefas_analista on cronograma_tarefas (analista_id);
create index if not exists idx_cronograma_tarefas_status   on cronograma_tarefas (status);

-- ── ROTINAS ─────────────────────────────────────────────────────────────────
create table if not exists cronograma_rotinas (
  id          text primary key,
  analista_id text references cronograma_analistas(id) on delete cascade,
  freq        text,                      -- diaria | semanal | mensal | eventual
  descricao   text,
  setor       text,
  obs         text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_cronograma_rotinas_analista on cronograma_rotinas (analista_id);

-- ── RLS: mesmo público do tile na home (admin, gerente, fiscal) ─────────────
alter table cronograma_analistas enable row level security;
alter table cronograma_tarefas   enable row level security;
alter table cronograma_rotinas   enable row level security;

-- Função auxiliar: usuário autenticado tem papel admin/gerente/fiscal em app_users?
create or replace function cronograma_is_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from app_users u
    where u.email = auth.jwt() ->> 'email'
      and u.role in ('admin', 'gerente', 'fiscal')
  );
$$;

drop policy if exists "cronograma_analistas_staff" on cronograma_analistas;
create policy "cronograma_analistas_staff" on cronograma_analistas
  for all
  using (cronograma_is_staff())
  with check (cronograma_is_staff());

drop policy if exists "cronograma_tarefas_staff" on cronograma_tarefas;
create policy "cronograma_tarefas_staff" on cronograma_tarefas
  for all
  using (cronograma_is_staff())
  with check (cronograma_is_staff());

drop policy if exists "cronograma_rotinas_staff" on cronograma_rotinas;
create policy "cronograma_rotinas_staff" on cronograma_rotinas
  for all
  using (cronograma_is_staff())
  with check (cronograma_is_staff());

commit;

-- Verificação pós-migração:
-- select * from cronograma_analistas;
-- select * from cronograma_tarefas;
-- select * from cronograma_rotinas;
