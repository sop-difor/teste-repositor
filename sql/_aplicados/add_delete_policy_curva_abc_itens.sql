-- Migração: permite excluir uma versão da Curva ABC do processo.
--
-- Contexto: curva_abc_itens.versao_id referencia curva_abc_versoes(id) on delete
-- cascade, mas create_curva_abc_processo.sql só criou políticas de RLS de select/
-- insert/update para curva_abc_itens — sem uma política de delete, o Postgres
-- bloqueia o cascade ao tentar apagar uma linha de curva_abc_versoes (RLS também
-- se aplica às linhas removidas em cascata).
--
-- Uso: rode este arquivo no SQL Editor do Supabase (Dashboard > SQL Editor).

begin;

drop policy if exists "curva_abc_itens_delete" on curva_abc_itens;
create policy "curva_abc_itens_delete" on curva_abc_itens
  for delete
  using (curva_abc_pode_escrever());

commit;
