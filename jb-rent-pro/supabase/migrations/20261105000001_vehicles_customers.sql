-- =====================================================================
-- JB RENT PRO — Migration 0003: veículos e clientes
-- ---------------------------------------------------------------------
--   * fotos de veículos (principal, externas, internas, detalhes)
--   * documentos de clientes (dados pessoais — acesso controlado)
--   * normalização de matrícula / documentos, unicidade por empresa
--   * quilometragem não pode diminuir (exceto adm. principal, para correções)
--   * anonimização de cliente (RGPD) pelo administrador principal
--   * RPCs: resumo financeiro do veículo, resumo do cliente, busca global
--   * Storage: exclusão por quem enviou, pasta de veículos para a equipe,
--     demais pastas apenas pelo administrador principal
-- =====================================================================

create type public.photo_kind as enum ('main', 'exterior', 'interior', 'detail');
create type public.customer_document_type as enum
  ('id_document', 'driving_licence', 'proof_of_address', 'company_registry', 'other');

alter table public.customers
  add column nationality    char(2),
  add column anonymized_at  timestamptz;

-- ---------------------------------------------------------------------
-- Fotos dos veículos
-- ---------------------------------------------------------------------
create table public.vehicle_photos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  kind          public.photo_kind not null default 'exterior',
  storage_path  text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  caption       text check (caption is null or length(caption) <= 200),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  constraint vehicle_photos_path_chk check (
    storage_path like (company_id::text || '/vehicles/' || vehicle_id::text || '/%')
  )
);
create index vehicle_photos_vehicle_idx on public.vehicle_photos(vehicle_id, kind, sort_order);
create unique index vehicle_photos_one_main_uidx on public.vehicle_photos(vehicle_id) where kind = 'main';

-- Mantém vehicles.main_photo_path (miniatura das listas) sincronizado
create or replace function app.sync_main_photo()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_vehicle uuid := coalesce(new.vehicle_id, old.vehicle_id);
begin
  update public.vehicles v
     set main_photo_path = (select p.storage_path from public.vehicle_photos p
                             where p.vehicle_id = v_vehicle and p.kind = 'main' limit 1)
   where v.id = v_vehicle
     and v.main_photo_path is distinct from (select p.storage_path from public.vehicle_photos p
                                              where p.vehicle_id = v_vehicle and p.kind = 'main' limit 1);
  return null;
end;
$$;
create trigger vehicle_photos_sync_main after insert or update or delete on public.vehicle_photos
  for each row execute function app.sync_main_photo();

-- ---------------------------------------------------------------------
-- Documentos dos clientes (dados pessoais)
-- ---------------------------------------------------------------------
create table public.customer_documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  customer_id     uuid not null references public.customers(id) on delete restrict,
  doc_type        public.customer_document_type not null,
  title           text not null check (length(trim(title)) between 1 and 200),
  storage_path    text not null unique,
  mime_type       text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  issued_at       date,
  expires_at      date,
  retention_until date,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  constraint customer_documents_path_chk check (
    storage_path like (company_id::text || '/customers/' || customer_id::text || '/%')
  ),
  constraint customer_documents_dates_chk check (expires_at is null or issued_at is null or expires_at >= issued_at)
);
create index customer_documents_customer_idx on public.customer_documents(customer_id) where archived_at is null;
create index customer_documents_expiry_idx on public.customer_documents(company_id, expires_at)
  where archived_at is null and expires_at is not null;

-- Documentos de veículos usam public.documents: o caminho deve ficar na pasta da empresa
alter table public.documents
  add constraint documents_path_chk check (storage_path like (company_id::text || '/%'));

-- ---------------------------------------------------------------------
-- Normalização e unicidade
-- ---------------------------------------------------------------------
create or replace function app.normalize_vehicle()
returns trigger
language plpgsql
as $$
begin
  new.plate := upper(regexp_replace(trim(new.plate), '\s+', ' ', 'g'));
  new.vin := nullif(upper(replace(trim(coalesce(new.vin, '')), ' ', '')), '');
  if tg_op = 'UPDATE' and new.current_mileage < old.current_mileage
     and auth.uid() is not null and not app.is_owner() then
    raise exception 'MILEAGE_DECREASE: mileage cannot go down (% → %)', old.current_mileage, new.current_mileage
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger vehicles_normalize before insert or update on public.vehicles
  for each row execute function app.normalize_vehicle();

create or replace function app.normalize_customer()
returns trigger
language plpgsql
as $$
begin
  new.id_document_number := nullif(upper(regexp_replace(coalesce(new.id_document_number, ''), '[\s.-]', '', 'g')), '');
  new.tax_id := nullif(upper(regexp_replace(coalesce(new.tax_id, ''), '[\s.-]', '', 'g')), '');
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.driving_licence_number := nullif(upper(regexp_replace(coalesce(new.driving_licence_number, ''), '\s', '', 'g')), '');
  return new;
end;
$$;
create trigger customers_normalize before insert or update on public.customers
  for each row execute function app.normalize_customer();

create unique index customers_doc_uidx on public.customers(company_id, id_document_type, id_document_number)
  where id_document_number is not null and archived_at is null;
create unique index customers_tax_uidx on public.customers(company_id, tax_id)
  where tax_id is not null and archived_at is null;

-- busca por texto: índices trigram (pg_trgm) para nome, empresa, telefone, matrícula
create extension if not exists pg_trgm;
create index customers_search_idx on public.customers using gin (
  (coalesce(full_name, '') || ' ' || coalesce(company_name, '') || ' ' || coalesce(legal_name, '')) gin_trgm_ops
);
create index vehicles_search_idx on public.vehicles using gin (
  (plate || ' ' || brand || ' ' || model || ' ' || coalesce(version, '')) gin_trgm_ops
);

-- ---------------------------------------------------------------------
-- Auditoria, RLS e privilégios das novas tabelas
-- ---------------------------------------------------------------------
create trigger vehicle_photos_audit before insert or update on public.vehicle_photos
  for each row execute function app.set_audit_fields();
create trigger customer_documents_audit before insert or update on public.customer_documents
  for each row execute function app.set_audit_fields();
create trigger vehicle_photos_log after insert or update or delete on public.vehicle_photos
  for each row execute function app.log_activity();
create trigger customer_documents_log after insert or update or delete on public.customer_documents
  for each row execute function app.log_activity();

alter table public.vehicle_photos enable row level security;
alter table public.customer_documents enable row level security;

create policy vehicle_photos_select on public.vehicle_photos for select to authenticated
  using (company_id = app.current_company_id());
create policy vehicle_photos_insert on public.vehicle_photos for insert to authenticated
  with check (company_id = app.current_company_id());
create policy vehicle_photos_update on public.vehicle_photos for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
-- fotos fazem parte da gestão de veículos: a equipe pode removê-las
create policy vehicle_photos_delete on public.vehicle_photos for delete to authenticated
  using (company_id = app.current_company_id());

create policy customer_documents_select on public.customer_documents for select to authenticated
  using (company_id = app.current_company_id());
create policy customer_documents_insert on public.customer_documents for insert to authenticated
  with check (company_id = app.current_company_id());
create policy customer_documents_update on public.customer_documents for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
-- dados pessoais: exclusão definitiva apenas pelo administrador principal
create policy customer_documents_delete on public.customer_documents for delete to authenticated
  using (company_id = app.current_company_id() and app.is_owner());

grant select, insert, update, delete on public.vehicle_photos, public.customer_documents to authenticated;
revoke all on public.vehicle_photos, public.customer_documents from anon;

-- Storage: substitui a política de exclusão (fase 1 = só proprietário)
drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = app.current_company_id()::text
    and (
      app.is_owner()
      or (storage.foldername(name))[2] = 'vehicles'   -- fotos/documentos de veículos
      or owner_id = auth.uid()::text                  -- quem enviou pode desfazer o envio
    )
  );

-- ---------------------------------------------------------------------
-- RGPD: anonimização do cliente
--   apaga dados pessoais mantendo o histórico contábil (contratos, valores).
--   Os arquivos dos documentos são removidos do Storage pela aplicação.
-- ---------------------------------------------------------------------
create or replace function public.anonymize_customer(p_customer_id uuid)
returns setof text
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid := app.current_company_id();
begin
  -- SECURITY DEFINER para poder limpar o registro de atividades; a permissão é verificada aqui
  if not app.is_owner() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and company_id = v_company and anonymized_at is null) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.rentals r
              where r.customer_id = p_customer_id and r.archived_at is null
                and r.status in ('reservation', 'confirmed', 'in_progress', 'late')) then
    raise exception 'CUSTOMER_HAS_ACTIVE_RENTALS' using errcode = 'P0001';
  end if;

  update public.customers
     set full_name = case when customer_type = 'individual' then 'Cliente anonimizado' else full_name end,
         company_name = case when customer_type = 'company' then 'Empresa anonimizada' else null end,
         legal_name = null, birth_date = null, id_document_number = null, driving_licence_number = null,
         driving_licence_expiry = null, tax_id = null, representative_name = null,
         billing_details = '{}'::jsonb, address = null, city = null, postal_code = null,
         phone = null, email = null, notes = null, nationality = null,
         marketing_consent = false, anonymized_at = now(), archived_at = coalesce(archived_at, now()),
         updated_by = auth.uid()
   where id = p_customer_id and company_id = v_company;

  -- devolve os caminhos dos arquivos para remoção no Storage e apaga os registros
  return query
    delete from public.customer_documents d
     where d.customer_id = p_customer_id and d.company_id = v_company
    returning d.storage_path;

  -- o histórico mantém QUEM fez O QUÊ e QUANDO, mas não os dados pessoais
  update public.activity_logs l
     set changes = jsonb_build_object('redacted', true)
   where l.company_id = v_company
     and ((l.entity = 'customers' and l.entity_id = p_customer_id::text)
          or (l.entity = 'customer_documents' and l.changes ->> 'customer_id' = p_customer_id::text)
          or (l.entity = 'customer_documents' and l.changes -> 'customer_id' ->> 'old' = p_customer_id::text));

  insert into public.activity_logs (company_id, user_id, action, entity, entity_id)
  values (v_company, auth.uid(), 'customer.anonymized', 'customers', p_customer_id::text);
end;
$$;
revoke all on function public.anonymize_customer(uuid) from public, anon;
grant execute on function public.anonymize_customer(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RPCs de consulta (SECURITY INVOKER → RLS)
-- ---------------------------------------------------------------------
create or replace function public.vehicle_financials(p_vehicle_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with ft as (
    select type, category, amount, is_operational from public.financial_transactions
    where vehicle_id = p_vehicle_id and archived_at is null and status <> 'cancelled'
  ),
  r as (
    select count(*) filter (where status <> 'cancelled') as rentals,
           coalesce(sum(greatest(0, ((coalesce(actual_return_at, return_at) at time zone 'Europe/Madrid')::date
                                    - (pickup_at at time zone 'Europe/Madrid')::date)))
                    filter (where status in ('confirmed', 'in_progress', 'late', 'completed')), 0) as rented_days
    from public.rentals where vehicle_id = p_vehicle_id and archived_at is null
  )
  select jsonb_build_object(
    'revenue',    coalesce((select sum(amount) from ft where type = 'income'), 0)::numeric(14,2),
    'expenses',   coalesce((select sum(amount) from ft where type = 'expense' and is_operational), 0)::numeric(14,2),
    'investment', coalesce((select sum(amount) from ft where category = 'vehicle_purchase'), 0)::numeric(14,2),
    'profit',     (coalesce((select sum(amount) from ft where type = 'income'), 0)
                   - coalesce((select sum(amount) from ft where type = 'expense' and is_operational), 0))::numeric(14,2),
    'rentals',     (select rentals from r),
    'rented_days', (select rented_days from r),
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'category', category, 'total', total) order by total desc)
                             from (select type, category, sum(amount)::numeric(14,2) as total from ft group by type, category) c), '[]'::jsonb)
  );
$$;

create or replace function public.customer_summary(p_customer_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'rentals',      (select count(*) from public.rentals where customer_id = p_customer_id and status <> 'cancelled' and archived_at is null),
    'active',       (select count(*) from public.rentals where customer_id = p_customer_id and archived_at is null
                       and status in ('reservation', 'confirmed', 'in_progress', 'late')),
    'billed',       coalesce((select sum(total_amount) from public.rentals where customer_id = p_customer_id
                       and status <> 'cancelled' and archived_at is null), 0)::numeric(14,2),
    'paid',         coalesce((select sum(amount) from public.financial_transactions where customer_id = p_customer_id
                       and type = 'income' and status = 'paid' and archived_at is null), 0)::numeric(14,2),
    'last_rental',  (select max(pickup_at) from public.rentals where customer_id = p_customer_id and status <> 'cancelled'),
    'vehicles',     (select count(distinct vehicle_id) from public.rentals where customer_id = p_customer_id and status <> 'cancelled')
  );
$$;

-- Busca global (veículos e clientes). O termo é tratado como texto literal.
create or replace function public.global_search(p_query text, p_limit integer default 20)
returns table (kind text, id uuid, title text, subtitle text, status text)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    select '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           regexp_replace(trim(p_query), '[\s.-]', '', 'g') as compact
  )
  (select 'vehicle'::text, v.id, v.brand || ' ' || v.model || coalesce(' ' || v.version, ''), v.plate, v.status::text
     from public.vehicles v, q
    where v.archived_at is null and length(trim(p_query)) >= 2
      and (v.plate ilike q.pat or replace(v.plate, ' ', '') ilike '%' || q.compact || '%'
           or v.brand ilike q.pat or v.model ilike q.pat or v.vin ilike q.pat
           or (v.brand || ' ' || v.model) ilike q.pat)
    order by v.plate
    limit greatest(1, least(p_limit, 50)))
  union all
  (select 'customer'::text, c.id,
          coalesce(case when c.customer_type = 'company' then c.company_name else c.full_name end, '—'),
          concat_ws(' · ', coalesce(c.id_document_number, c.tax_id), c.phone, c.email),
          c.customer_type::text
     from public.customers c, q
    where c.archived_at is null and length(trim(p_query)) >= 2
      and (c.full_name ilike q.pat or c.company_name ilike q.pat or c.legal_name ilike q.pat
           or c.email ilike q.pat or c.representative_name ilike q.pat
           or c.id_document_number ilike '%' || upper(q.compact) || '%'
           or c.tax_id ilike '%' || upper(q.compact) || '%'
           or regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || nullif(regexp_replace(p_query, '\D', '', 'g'), '') || '%')
    order by 3
    limit greatest(1, least(p_limit, 50)));
$$;

revoke all on function public.vehicle_financials(uuid) from public, anon;
revoke all on function public.customer_summary(uuid) from public, anon;
revoke all on function public.global_search(text, integer) from public, anon;
grant execute on function public.vehicle_financials(uuid) to authenticated;
grant execute on function public.customer_summary(uuid) to authenticated;
grant execute on function public.global_search(text, integer) to authenticated;

-- event list: arquivos enviados/removidos pela aplicação
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('user.invite', 'user.password_link', 'user.sessions_revoked', 'company.logo_updated',
                      'customer.anonymized', 'file.downloaded') then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (app.current_company_id(), auth.uid(), p_action, left(p_entity, 60), left(p_entity_id, 100), p_details);
end;
$$;
