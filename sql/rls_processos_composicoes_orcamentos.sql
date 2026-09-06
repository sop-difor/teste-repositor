-- Script: rls_processos_composicoes_orcamentos.sql
-- Objetivo: Fase 4 do plano de permissões por papel — RLS de verdade nas 3
-- tabelas centrais do GECOPE que HOJE NÃO TÊM NENHUMA RLS: processos,
-- composicoes_biblioteca, orcamentos_biblioteca. Até aqui (Fases 1-3), a
-- restrição de quem grava/exclui/vê o quê era só front-end (esconder botão) —
-- qualquer usuário autenticado, chamando a API do Supabase direto, conseguia
-- passar por cima. Este script fecha isso no banco.
--
-- ⚠️ RISCO DESTA MIGRAÇÃO: é a PRIMEIRA vez que RLS é ativado nessas 3 tabelas,
-- que já estão em uso real no piloto. Ao ativar ENABLE ROW LEVEL SECURITY sem
-- a policy certa pra alguma operação já em uso, essa operação passa a falhar
-- silenciosamente pra todo mundo (RLS nega por padrão quem não bate em
-- nenhuma policy). Recomenda-se testar cada ação abaixo com um usuário de
-- cada papel (admin/gerente/fiscal/externo) logo após aplicar, de preferência
-- fora do horário de pico do piloto.
--
-- Regras implementadas (resumo — a matriz completa está no plano):
--   processos:            Admin/Gerente = tudo. Fiscal = só os vinculados a
--                          ele (por matrícula; sem matrícula vinculada, o
--                          processo continua visível — decisão explícita do
--                          usuário, pra não esconder dado por causa de
--                          cadastro incompleto). Externo = vê tudo, só leitura.
--                          Prioridade/meta continuam só-Admin (regra que já
--                          existia só no front, agora também no banco).
--   composicoes_biblioteca: todos autenticados com papel válido veem e criam;
--                          "nova versão" (editar) é Admin/Gerente/dono;
--                          excluir é Admin/Gerente/dono; comentar é aberto.
--   orcamentos_biblioteca: todos autenticados com papel válido veem;
--                          criar/nova versão/excluir é só Admin/Gerente;
--                          comentar é aberto (não existe "dono" nesta tabela).
--
-- ACHADO/LIMITAÇÃO CONHECIDA (registrar, não bloqueante): em ambas
-- composicoes_biblioteca e orcamentos_biblioteca, "adicionar comentário"
-- (aberto a todos) e "excluir um item do histórico"/"decisão de
-- atender/recusar" (hoje só-Admin, só no front-end) escrevem na MESMA coluna
-- (comentarios_revisao) — não dá pra diferenciar essas duas ações só pela
-- coluna que mudou (só o CONTEÚDO do array muda). Este script libera as duas
-- pro banco (mantém aberto o que já era pro front), confiando no front-end pra
-- esconder os botões de decisão/exclusão de item de quem não é Admin — exatamente
-- o mesmo nível de proteção que existe hoje. Fechar isso por completo exigiria
-- reestruturar essas duas ações como colunas/tabelas próprias ou funções RPC
-- dedicadas — fica como possível fase futura, não fizemos aqui pra não
-- arriscar quebrar comentário/versão que já funcionam.
--
-- Idempotente: toda função é CREATE OR REPLACE, toda policy/trigger tem
-- DROP ... IF EXISTS antes.

BEGIN;

-- ---------------------------------------------------------------------------
-- Funções auxiliares (mesmo estilo de app_users_is_admin() /
-- contratos_edificacao_pode_ler(), já usados no projeto)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meu_papel()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.role from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email') limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.minha_matricula()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.matricula from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email') limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.tem_papel_valido()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.app_users u
    where lower(u.email) = lower(auth.jwt() ->> 'email')
      and u.role in ('admin','gerente','fiscal','externo'));
$function$;

-- =============================================================================
-- PROCESSOS
-- =============================================================================
ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "processos_select" ON public.processos;
CREATE POLICY "processos_select"
  ON public.processos
  FOR SELECT
  TO authenticated
  USING (
    public.meu_papel() IN ('admin','gerente','externo')
    OR (
      public.meu_papel() = 'fiscal'
      AND (
        processos.fiscal_matricula = public.minha_matricula()
        OR processos.fiscal_matricula IS NULL
      )
    )
  );

DROP POLICY IF EXISTS "processos_insert" ON public.processos;
CREATE POLICY "processos_insert"
  ON public.processos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.meu_papel() IN ('admin','gerente'));

DROP POLICY IF EXISTS "processos_update" ON public.processos;
CREATE POLICY "processos_update"
  ON public.processos
  FOR UPDATE
  TO authenticated
  USING (public.meu_papel() IN ('admin','gerente'))
  WITH CHECK (public.meu_papel() IN ('admin','gerente'));

-- Sem policy de DELETE: a exclusão de processo hoje é sempre soft-delete
-- (UPDATE status='EXCLUÍDO'), nunca DELETE de verdade — sem policy, o banco
-- nega qualquer tentativa de DELETE físico, pra ninguém (nem Admin), o que é
-- o comportamento correto (não existe essa ação na aplicação hoje).

-- "Prioritário" e "meta" já eram só-Admin (nem Gerente) só no front
-- (canMarkProcessAsPriority/canMarkDateAsMeta) — preserva essa regra também
-- no banco.
--
-- Achado do rev-correcao: data_compromisso_fiscal (a "meta") também é
-- recalculada automaticamente como EFEITO COLATERAL de ações normais que
-- Gerente já pode fazer (criar processo, mudar status pra/de "Análise
-- Fiscal" dentro do "Salvar" comum de executarAcaoDetalhes) — bloquear
-- QUALQUER mudança nessa coluna quebraria o Salvar do Gerente sempre que
-- isso acontecesse. Por isso ela só é bloqueada quando é a ÚNICA coisa que
-- muda no UPDATE (clique manual no botão de Meta).
--
-- Achado do rev-seguranca (2ª rodada — mesma classe de erro que já tinha
-- aparecido em composições/orçamentos, escalado ao usuário antes de corrigir
-- de novo): tratar `prioritario` com a MESMA lógica "só bloqueia se mudou
-- sozinha" abria uma brecha — mandando `prioritario` e `data_compromisso_fiscal`
-- juntos (ou `prioritario` com qualquer outra coluna) no mesmo UPDATE, nenhuma
-- das duas checagens via "sozinha", e nada bloqueava. Diferença importante
-- entre as duas colunas: `prioritario` NUNCA muda como efeito colateral de
-- nada — só existe um caminho de escrita pra ela (o clique manual na estrela,
-- setPrioritario()), então não precisa (e não pode) ter a exceção de "mudou
-- junto com outra coisa": é sempre só-Admin, incondicionalmente. Só
-- `data_compromisso_fiscal` mantém a exceção de coluna isolada.
CREATE OR REPLACE FUNCTION public.processos_restringir_prioridade_meta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_so_meta boolean;
BEGIN
  IF public.meu_papel() = 'admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.prioritario IS DISTINCT FROM OLD.prioritario THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar prioridade de processos.';
  END IF;

  v_so_meta := (NEW.data_compromisso_fiscal IS DISTINCT FROM OLD.data_compromisso_fiscal)
    AND (to_jsonb(NEW) - 'data_compromisso_fiscal') = (to_jsonb(OLD) - 'data_compromisso_fiscal');

  IF v_so_meta THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar a meta de processos manualmente.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_processos_restringir_prioridade_meta ON public.processos;
CREATE TRIGGER trg_processos_restringir_prioridade_meta
  BEFORE UPDATE ON public.processos
  FOR EACH ROW EXECUTE FUNCTION public.processos_restringir_prioridade_meta();

-- =============================================================================
-- COMPOSICOES_BIBLIOTECA
-- =============================================================================
ALTER TABLE public.composicoes_biblioteca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "composicoes_select" ON public.composicoes_biblioteca;
CREATE POLICY "composicoes_select"
  ON public.composicoes_biblioteca
  FOR SELECT
  TO authenticated
  USING (public.tem_papel_valido());

DROP POLICY IF EXISTS "composicoes_insert" ON public.composicoes_biblioteca;
CREATE POLICY "composicoes_insert"
  ON public.composicoes_biblioteca
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.tem_papel_valido()
    AND lower(criador_email) = lower(auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS "composicoes_update" ON public.composicoes_biblioteca;
CREATE POLICY "composicoes_update"
  ON public.composicoes_biblioteca
  FOR UPDATE
  TO authenticated
  USING (public.tem_papel_valido())
  WITH CHECK (public.tem_papel_valido());

DROP POLICY IF EXISTS "composicoes_delete" ON public.composicoes_biblioteca;
CREATE POLICY "composicoes_delete"
  ON public.composicoes_biblioteca
  FOR DELETE
  TO authenticated
  USING (
    public.meu_papel() IN ('admin','gerente')
    OR lower(criador_email) = lower(auth.jwt() ->> 'email')
  );

-- Achado do rev-seguranca: a versão anterior liberava a gravação sempre que
-- as 4 colunas de versionamento NÃO mudavam — mas isso não é o mesmo que "só
-- mudou o comentário": um Externo podia reescrever criador_email (sequestro
-- de dono, escalando pra poder depois excluir/editar a composição) ou
-- qualquer outra coluna, contanto que não tocasse nas 4 de versão. A checagem
-- certa é positiva: só libera pra quem não é admin/gerente quando NENHUMA
-- coluna, além de comentarios_revisao/status, mudou — é assim que
-- comentário, decisão de atender/recusar e exclusão de item do histórico
-- (as 3 ações que hoje só mexem nessas 2 colunas, ver limitação no cabeçalho
-- do arquivo) continuam abertas, sem abrir uma porta pra reescrever mais
-- nada.
CREATE OR REPLACE FUNCTION public.composicoes_pode_atualizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_so_comentario boolean;
BEGIN
  IF public.meu_papel() IN ('admin','gerente') THEN
    RETURN NEW;
  END IF;

  v_so_comentario := (to_jsonb(NEW) - 'comentarios_revisao' - 'status')
                    = (to_jsonb(OLD) - 'comentarios_revisao' - 'status');

  IF v_so_comentario THEN
    RETURN NEW; -- comentário/decisão/exclusão-de-item: aberto a qualquer papel válido
  END IF;

  IF lower(OLD.criador_email) = lower(auth.jwt() ->> 'email') THEN
    RETURN NEW; -- dono pode enviar nova versão (ou qualquer outra edição)
  END IF;

  RAISE EXCEPTION 'Você só pode editar (nova versão) composições que você mesmo criou.';
END;
$function$;

DROP TRIGGER IF EXISTS trg_composicoes_pode_atualizar ON public.composicoes_biblioteca;
CREATE TRIGGER trg_composicoes_pode_atualizar
  BEFORE UPDATE ON public.composicoes_biblioteca
  FOR EACH ROW EXECUTE FUNCTION public.composicoes_pode_atualizar();

-- =============================================================================
-- ORCAMENTOS_BIBLIOTECA
-- =============================================================================
ALTER TABLE public.orcamentos_biblioteca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orcamentos_select" ON public.orcamentos_biblioteca;
CREATE POLICY "orcamentos_select"
  ON public.orcamentos_biblioteca
  FOR SELECT
  TO authenticated
  USING (public.tem_papel_valido());

DROP POLICY IF EXISTS "orcamentos_insert" ON public.orcamentos_biblioteca;
CREATE POLICY "orcamentos_insert"
  ON public.orcamentos_biblioteca
  FOR INSERT
  TO authenticated
  WITH CHECK (public.meu_papel() IN ('admin','gerente'));

DROP POLICY IF EXISTS "orcamentos_update" ON public.orcamentos_biblioteca;
CREATE POLICY "orcamentos_update"
  ON public.orcamentos_biblioteca
  FOR UPDATE
  TO authenticated
  USING (public.tem_papel_valido())
  WITH CHECK (public.tem_papel_valido());

DROP POLICY IF EXISTS "orcamentos_delete" ON public.orcamentos_biblioteca;
CREATE POLICY "orcamentos_delete"
  ON public.orcamentos_biblioteca
  FOR DELETE
  TO authenticated
  USING (public.meu_papel() IN ('admin','gerente'));

-- Achado do rev-seguranca (mesmo problema encontrado em composicoes_biblioteca):
-- checagem tem que ser positiva ("só mudou comentarios_revisao/status"), não
-- "não mudou as colunas de versão" — senão qualquer outra coluna fica livre
-- pra reescrever. Sem conceito de "dono" nesta tabela (não tem coluna de
-- autoria), então fora do caminho de comentário é sempre Admin/Gerente.
CREATE OR REPLACE FUNCTION public.orcamentos_pode_atualizar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_so_comentario boolean;
BEGIN
  IF public.meu_papel() IN ('admin','gerente') THEN
    RETURN NEW;
  END IF;

  v_so_comentario := (to_jsonb(NEW) - 'comentarios_revisao' - 'status')
                    = (to_jsonb(OLD) - 'comentarios_revisao' - 'status');

  IF v_so_comentario THEN
    RETURN NEW; -- comentário/decisão/exclusão-de-item: aberto a qualquer papel válido
  END IF;

  RAISE EXCEPTION 'Nova versão de orçamento é permitida só para Admin/Gerente.';
END;
$function$;

DROP TRIGGER IF EXISTS trg_orcamentos_pode_atualizar ON public.orcamentos_biblioteca;
CREATE TRIGGER trg_orcamentos_pode_atualizar
  BEFORE UPDATE ON public.orcamentos_biblioteca
  FOR EACH ROW EXECUTE FUNCTION public.orcamentos_pode_atualizar();

COMMIT;
