-- =====================================================================
-- JB RENT PRO — Migration 0005: inspeções, avarias e fotografias
-- ---------------------------------------------------------------------
--   * inspeções de entrega, devolução e periódicas, com checklist por área
--     (carroceria, vidros, luzes, pneus, interior, porta-malas, kit)
--   * fotos por área da inspeção e fotos de cada avaria
--   * uma inspeção de entrega e uma de devolução por contrato
--   * inspeção concluída = evidência: não muda e não é excluída
--   * avarias com categoria, gravidade, custos estimado/real e situação
--   * entrega concluída por inspeção registra a entrega do contrato
--   * alerta de avarias graves em aberto
-- =====================================================================

create type public.inspection_type as enum ('delivery', 'return', 'periodic');
create type public.inspection_status as enum ('draft', 'completed');
create type public.damage_category as enum
  ('scratch', 'dent', 'paint', 'mechanical', 'electrical', 'tyres', 'glass', 'interior', 'other');
create type public.damage_severity as enum ('low', 'medium', 'high', 'critical');
create type public.damage_status as enum ('pending', 'in_repair', 'resolved');

-- Áreas do checklist (validadas também na aplicação)
create or replace function app.inspection_areas()
returns text[]
language sql immutable
as $$
  select array['front', 'rear', 'left_side', 'right_side', 'roof', 'glass', 'lights', 'wheels_tyres',
               'interior', 'dashboard', 'trunk', 'safety_kit']
$$;

-- checklist: {"front": {"condition": "ok|minor|damaged|not_checked", "notes": "..."}, ...}
create or replace function app.valid_checklist(p jsonb)
returns boolean
language sql immutable
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
       where not (e.key = any (app.inspection_areas()))
          or jsonb_typeof(e.value) <> 'object'
          or coalesce(e.value ->> 'condition', '') not in ('ok', 'minor', 'damaged', 'not_checked')
          or length(coalesce(e.value ->> 'notes', '')) > 500)
$$;

create table public.inspections (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id         uuid not null references public.vehicles(id) on delete restrict,
  rental_id          uuid references public.rentals(id) on delete restrict,
  inspection_type    public.inspection_type not null,
  status             public.inspection_status not null default 'draft',
  performed_at       timestamptz not null default now(),
  mileage            integer check (mileage >= 0),
  fuel_level         smallint check (fuel_level between 0 and 100),
  checklist          jsonb not null default '{}'::jsonb check (app.valid_checklist(checklist)),
  existing_damages_confirmed boolean not null default false,
  customer_present   boolean not null default true,
  customer_name      text check (customer_name is null or length(customer_name) <= 160),
  observations       text check (observations is null or length(observations) <= 4000),
  completed_at       timestamptz,
  completed_by       uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null,
  constraint inspections_rental_type_chk check (
    (inspection_type = 'periodic') or rental_id is not null),
  constraint inspections_completed_chk check (
    status = 'draft' or (mileage is not null and fuel_level is not null and completed_at is not null))
);
create unique index inspections_rental_type_uidx on public.inspections(rental_id, inspection_type)
  where rental_id is not null;
create index inspections_vehicle_idx on public.inspections(vehicle_id, performed_at desc);
create index inspections_company_idx on public.inspections(company_id, status, performed_at desc);

create table public.inspection_photos (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  inspection_id  uuid not null references public.inspections(id) on delete cascade,
  area           text not null check (area = any (app.inspection_areas()) or area = 'general'),
  storage_path   text not null unique,
  mime_type      text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  caption        text check (caption is null or length(caption) <= 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  updated_by     uuid references auth.users(id) on delete set null,
  constraint inspection_photos_path_chk check (storage_path like (company_id::text || '/vehicles/%/inspections/' || inspection_id::text || '/%'))
);
create index inspection_photos_inspection_idx on public.inspection_photos(inspection_id, area);

create table public.damages (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id       uuid not null references public.vehicles(id) on delete restrict,
  rental_id        uuid references public.rentals(id) on delete restrict,
  customer_id      uuid references public.customers(id) on delete restrict,
  inspection_id    uuid references public.inspections(id) on delete set null,
  detected_at      date not null default ((now() at time zone 'Europe/Madrid')::date),
  mileage          integer check (mileage >= 0),
  area             text check (area is null or area = any (app.inspection_areas())),
  category         public.damage_category not null,
  severity         public.damage_severity not null default 'low',
  description      text not null check (length(trim(description)) between 3 and 2000),
  estimated_cost   numeric(12,2) check (estimated_cost >= 0),
  actual_cost      numeric(12,2) check (actual_cost >= 0),
  status           public.damage_status not null default 'pending',
  repair_shop      text check (repair_shop is null or length(repair_shop) <= 160),
  resolved_at      date,
  notes            text check (notes is null or length(notes) <= 4000),
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  constraint damages_resolved_chk check (status <> 'resolved' or resolved_at is not null)
);
create index damages_vehicle_idx on public.damages(vehicle_id, status) where archived_at is null;
create index damages_company_idx on public.damages(company_id, status, detected_at desc) where archived_at is null;
create index damages_rental_idx on public.damages(rental_id);
create index damages_customer_idx on public.damages(customer_id);

create table public.damage_photos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  damage_id     uuid not null references public.damages(id) on delete cascade,
  storage_path  text not null unique,
  mime_type     text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  caption       text check (caption is null or length(caption) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  constraint damage_photos_path_chk check (storage_path like (company_id::text || '/vehicles/%/damages/' || damage_id::text || '/%'))
);
create index damage_photos_damage_idx on public.damage_photos(damage_id);

-- ---------------------------------------------------------------------
-- Regras
-- ---------------------------------------------------------------------
create or replace function app.guard_inspection()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      raise exception 'INSPECTION_LOCKED: completed inspections are evidence' using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- contrato e veículo devem ser coerentes
  if new.rental_id is not null then
    select vehicle_id, company_id, status into r from public.rentals where id = new.rental_id;
    if not found or r.company_id <> new.company_id or r.vehicle_id <> new.vehicle_id then
      raise exception 'INSPECTION_RENTAL_MISMATCH' using errcode = 'P0001';
    end if;
    if new.inspection_type = 'return' and tg_op = 'INSERT' and r.status not in ('in_progress', 'late', 'completed') then
      raise exception 'INSPECTION_RENTAL_NOT_ACTIVE: return inspection needs a delivered rental' using errcode = 'P0001';
    end if;
    if new.inspection_type = 'delivery' and tg_op = 'INSERT' and r.status in ('cancelled', 'completed') then
      raise exception 'INSPECTION_RENTAL_NOT_ACTIVE' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'completed' then
    raise exception 'INSPECTION_LOCKED: completed inspections are evidence' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.vehicle_id, new.rental_id, new.inspection_type) is distinct from (old.vehicle_id, old.rental_id, old.inspection_type) then
    raise exception 'INSPECTION_LOCKED' using errcode = 'P0001';
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
    if new.mileage is null or new.fuel_level is null then
      raise exception 'INSPECTION_DATA_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger inspections_guard before insert or update or delete on public.inspections
  for each row execute function app.guard_inspection();

-- Fotos de inspeção concluída não mudam
create or replace function app.guard_inspection_photo()
returns trigger
language plpgsql
as $$
begin
  if (select status from public.inspections where id = coalesce(new.inspection_id, old.inspection_id)) = 'completed' then
    raise exception 'INSPECTION_LOCKED' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger inspection_photos_guard before insert or update or delete on public.inspection_photos
  for each row execute function app.guard_inspection_photo();

-- Inspeção de entrega concluída → registra a entrega do contrato (km e combustível)
create or replace function app.after_inspection_completed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status = 'draft' and new.inspection_type = 'delivery' and new.rental_id is not null then
    update public.rentals
       set status = 'in_progress', start_mileage = new.mileage, start_fuel_level = new.fuel_level,
           picked_up_at = coalesce(picked_up_at, new.completed_at)
     where id = new.rental_id and status in ('reservation', 'confirmed');
  end if;
  -- km do veículo nunca diminui
  if new.status = 'completed' and old.status = 'draft' then
    update public.vehicles set current_mileage = greatest(current_mileage, new.mileage) where id = new.vehicle_id;
  end if;
  return null;
end;
$$;
create trigger inspections_after_completed after update on public.inspections
  for each row execute function app.after_inspection_completed();

create or replace function app.normalize_damage()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.rental_id is not null then
    select vehicle_id, customer_id, company_id into r from public.rentals where id = new.rental_id;
    if not found or r.company_id <> new.company_id or r.vehicle_id <> new.vehicle_id then
      raise exception 'DAMAGE_RENTAL_MISMATCH' using errcode = 'P0001';
    end if;
    new.customer_id := coalesce(new.customer_id, r.customer_id);
  end if;
  if new.status = 'resolved' and new.resolved_at is null then
    new.resolved_at := (now() at time zone 'Europe/Madrid')::date;
  end if;
  if new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
create trigger damages_normalize before insert or update on public.damages
  for each row execute function app.normalize_damage();

-- ---------------------------------------------------------------------
-- Auditoria, RLS e privilégios
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['inspections', 'inspection_photos', 'damages', 'damage_photos'] loop
    execute format('create trigger %1$s_audit before insert or update on public.%1$I
                    for each row execute function app.set_audit_fields()', t);
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I
                    for each row execute function app.log_activity()', t);
    execute format('alter table public.%1$I enable row level security', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (company_id = app.current_company_id()) with check (company_id = app.current_company_id())', t);
  end loop;
end $$;

-- rascunhos de inspeção e fotos: a equipe pode remover (a guarda protege as concluídas)
create policy inspections_delete on public.inspections for delete to authenticated
  using (company_id = app.current_company_id());
create policy inspection_photos_delete on public.inspection_photos for delete to authenticated
  using (company_id = app.current_company_id());
create policy damage_photos_delete on public.damage_photos for delete to authenticated
  using (company_id = app.current_company_id());
-- avarias: arquivar (equipe); excluir somente o administrador principal
create policy damages_delete on public.damages for delete to authenticated
  using (company_id = app.current_company_id() and app.is_owner());

grant select, insert, update, delete on public.inspections, public.inspection_photos, public.damages, public.damage_photos to authenticated;
revoke all on public.inspections, public.inspection_photos, public.damages, public.damage_photos from anon;

-- eventos de relatórios gerados
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('user.invite', 'user.password_link', 'user.sessions_revoked', 'company.logo_updated',
                      'customer.anonymized', 'file.downloaded', 'report.generated') then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (app.current_company_id(), auth.uid(), p_action, left(p_entity, 60), left(p_entity_id, 100), p_details);
end;
$$;

-- ---------------------------------------------------------------------
-- Alertas: avarias graves em aberto
-- ---------------------------------------------------------------------
create or replace function public.dashboard_alerts(p_limit integer default 20)
returns table (kind text, severity text, entity text, entity_id uuid, title text, due_date date)
language sql stable security invoker set search_path = ''
as $$
  with today as (select (now() at time zone 'Europe/Madrid')::date as d),
  a as (
    select 'rental_overdue'::text as kind, 'critical'::text as severity, 'rentals'::text as entity, r.id,
           r.contract_number || ' · ' || v.plate as title,
           (r.return_at at time zone 'Europe/Madrid')::date as due
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('in_progress', 'late') and r.return_at < now()
    union all
    select 'rental_return_soon', 'info', 'rentals', r.id, r.contract_number || ' · ' || v.plate,
           (r.return_at at time zone 'Europe/Madrid')::date
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('in_progress', 'late')
      and r.return_at >= now() and r.return_at < now() + interval '3 days'
    union all
    select 'rental_pickup_soon', 'info', 'rentals', r.id, r.contract_number || ' · ' || v.plate,
           (r.pickup_at at time zone 'Europe/Madrid')::date
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('reservation', 'confirmed')
      and r.pickup_at >= now() - interval '1 day' and r.pickup_at < now() + interval '3 days'
    union all
    select case when ip.end_date < t.d then 'insurance_expired' else 'insurance_expiring' end,
           case when ip.end_date < t.d then 'critical' when ip.end_date <= t.d + 7 then 'high'
                when ip.end_date <= t.d + 15 then 'medium' else 'low' end,
           'insurance_policies', ip.id, ip.insurer || ' · ' || v.plate, ip.end_date
    from public.insurance_policies ip join public.vehicles v on v.id = ip.vehicle_id cross join today t
    where ip.archived_at is null and v.archived_at is null and v.status <> 'sold' and ip.end_date <= t.d + 30
      and not exists (select 1 from public.insurance_policies n where n.renewed_from_id = ip.id and n.archived_at is null)
    union all
    select case when v.itv_due_date < t.d then 'itv_expired' else 'itv_expiring' end,
           case when v.itv_due_date < t.d then 'critical' when v.itv_due_date <= t.d + 7 then 'high'
                when v.itv_due_date <= t.d + 15 then 'medium' else 'low' end,
           'vehicles', v.id, v.brand || ' ' || v.model || ' · ' || v.plate, v.itv_due_date
    from public.vehicles v cross join today t
    where v.archived_at is null and v.status <> 'sold' and v.itv_due_date is not null and v.itv_due_date <= t.d + 30
    union all
    select case when d.expires_at < t.d then 'document_expired' else 'document_expiring' end,
           case when d.expires_at < t.d then 'critical' when d.expires_at <= t.d + 7 then 'high' else 'medium' end,
           'documents', d.id, d.title, d.expires_at
    from public.documents d cross join today t
    where d.archived_at is null and d.expires_at is not null and d.expires_at <= t.d + 30
    union all
    select 'payment_overdue', 'high', 'financial_transactions', f.id, f.description, f.due_date
    from public.financial_transactions f cross join today t
    where f.archived_at is null and f.status = 'pending' and f.due_date is not null and f.due_date < t.d
    union all
    select 'deposit_pending', 'medium', 'deposits', dp.id, r.contract_number || ' · ' || v.plate,
           (r.actual_return_at at time zone 'Europe/Madrid')::date
    from public.deposits dp join public.rentals r on r.id = dp.rental_id join public.vehicles v on v.id = dp.vehicle_id
    where dp.status = 'held' and r.status = 'completed'
    union all
    select 'damage_open', dm.severity::text, 'damages', dm.id, v.brand || ' ' || v.model || ' · ' || v.plate, dm.detected_at
    from public.damages dm join public.vehicles v on v.id = dm.vehicle_id
    where dm.archived_at is null and dm.status <> 'resolved' and dm.severity in ('high', 'critical') and v.archived_at is null
  )
  select kind, severity, entity, id, title, due
  from a
  order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
           due nulls last
  limit greatest(1, least(p_limit, 100));
$$;
