-- =====================================================================
-- JB RENT PRO — Migration 0010: endurecimento (revisão de segurança)
-- ---------------------------------------------------------------------
--   * documentos da empresa: exclusão definitiva somente pela função
--     purge_document (administrador principal + prazo de retenção vencido)
-- =====================================================================
create trigger documents_no_hard_delete before delete on public.documents
  for each row execute function app.prevent_hard_delete();
