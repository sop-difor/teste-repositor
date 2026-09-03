-- Migração: item "10. Outros" do Checklist de Documentação do Aditivo passa a ter
-- resposta Sim/Não (igual aos demais itens), em vez de ser só uma caixa de texto livre.
-- A coluna outros_obs (texto) já existia e continua guardando o comentário, usado
-- apenas quando outros_flag = true.
--
-- Nullable porque registros já finalizados antes desta migração não têm essa resposta.
--
-- Uso: rode este arquivo no SQL Editor do Supabase (Dashboard > SQL Editor).

alter table checklist_documentacao_aditivo
  add column if not exists outros_flag boolean;
