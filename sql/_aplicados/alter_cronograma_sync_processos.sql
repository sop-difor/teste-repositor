-- Migração: suporte à sincronização automática Processos → Atividades
-- Rode este arquivo no SQL Editor do Supabase DEPOIS de já ter rodado
-- sql/create_cronograma_tables.sql.

begin;

-- Marca tarefas criadas/atualizadas automaticamente a partir de um processo
-- (permite diferenciar de tarefas criadas manualmente pelo analista, mesmo
-- que por coincidência usem o mesmo número de processo).
alter table cronograma_tarefas
  add column if not exists origem_sync boolean not null default false;

-- Guarda o texto exato do status vindo da aba Processos (ex.: "EM REANÁLISE"),
-- usado para exibir o status real na tarefa sincronizada em vez do rótulo
-- genérico "Em Execução".
alter table cronograma_tarefas
  add column if not exists status_processo text;

create index if not exists idx_cronograma_tarefas_origem_sync
  on cronograma_tarefas (origem_sync) where origem_sync = true;

commit;
