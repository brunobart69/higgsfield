-- =====================================================================
-- JB RENT PRO — Verificação da instalação (cole no SQL Editor e clique em Run)
-- Todas as linhas devem mostrar ok = true.
-- =====================================================================
with checks(item, ok) as (
  values
  ('tabelas principais', (select count(*) = 27 from information_schema.tables where table_schema = 'public' and table_name in (
     'companies','profiles','activity_logs','vehicles','vehicle_valuations','customers','rentals','insurance_policies','documents',
     'financial_transactions','fee_catalog','branches','vehicle_photos','customer_documents','rental_extras','rental_payments','deposits',
     'inspections','inspection_photos','damages','damage_photos','maintenance_plans','maintenance_records','traffic_fines','accidents',
     'notifications','customer_portal_accounts'))),
  ('RLS ativa em todas as tabelas', (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                      where n.nspname = 'public' and c.relkind = 'r')),
  ('bloqueio de reservas sobrepostas', exists (select 1 from pg_constraint where conname = 'rentals_no_overlap')),
  ('bucket privado de documentos', exists (select 1 from storage.buckets where id = 'documents' and public = false)),
  ('categorias financeiras (fase 8)', exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'transaction_category' and e.enumlabel = 'owner_withdrawal')),
  ('área do cliente (fase 9)', exists (select 1 from pg_proc where proname = 'portal_me')),
  ('endurecimento (fase 10)', exists (select 1 from pg_trigger where tgname = 'documents_no_hard_delete')),
  ('administrador principal criado', exists (select 1 from public.profiles where role = 'owner' and is_active))
)
select item, ok from checks;
-- A última linha só fica true depois de criar o primeiro usuário (Authentication → Users → Add user).
