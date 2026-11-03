-- =====================================================================
-- JB RENT PRO — Migration 0009: calendário, notificações e área do cliente
-- ---------------------------------------------------------------------
--   * calendar_events: contratos, manutenções, vencimentos de seguro/ITV e
--     prazos de multas num único feed; available_vehicles: busca por período
--   * notificações persistentes por empresa, geradas a partir dos alertas,
--     com leitura por usuário e resolução automática
--   * área do cliente: conta vinculada a UM cliente (sem perfil da equipe),
--     acesso somente por funções que filtram pelo próprio cliente
--   * solicitações de reserva feitas pelo cliente
-- =====================================================================

-- ---------------------------------------------------------------------
-- Calendário
-- ---------------------------------------------------------------------
create or replace function public.calendar_events(p_from date, p_to date)
returns table (kind text, id uuid, vehicle_id uuid, plate text, title text, subtitle text,
               starts_at timestamptz, ends_at timestamptz, all_day boolean, status text)
language sql stable security invoker set search_path = ''
as $$
  with b as (
    select (p_from::timestamp at time zone 'Europe/Madrid') as f,
           ((p_to + 1)::timestamp at time zone 'Europe/Madrid') as t
  )
  select 'rental', r.id, r.vehicle_id, v.plate, r.contract_number,
         coalesce(case when c.customer_type = 'company' then c.company_name else c.full_name end, ''),
         r.pickup_at, coalesce(r.actual_return_at, r.return_at), false, r.status::text
  from public.rentals r join public.vehicles v on v.id = r.vehicle_id join public.customers c on c.id = r.customer_id cross join b
  where r.archived_at is null and r.status <> 'cancelled'
    and r.pickup_at < b.t and coalesce(r.actual_return_at, r.return_at) >= b.f
  union all
  select 'maintenance', m.id, m.vehicle_id, v.plate, m.title, coalesce(m.workshop, ''),
         (coalesce(m.started_at, m.scheduled_date)::timestamp at time zone 'Europe/Madrid'),
         ((coalesce(m.completed_date, greatest(coalesce(m.started_at, m.scheduled_date), case when m.status = 'in_progress' then (now() at time zone 'Europe/Madrid')::date end)) + 1)::timestamp at time zone 'Europe/Madrid'),
         true, m.status::text
  from public.maintenance_records m join public.vehicles v on v.id = m.vehicle_id
  where m.archived_at is null and m.status <> 'cancelled' and coalesce(m.started_at, m.scheduled_date) is not null
    and coalesce(m.started_at, m.scheduled_date) <= p_to
    and coalesce(m.completed_date, greatest(coalesce(m.started_at, m.scheduled_date), case when m.status = 'in_progress' then (now() at time zone 'Europe/Madrid')::date end)) >= p_from
  union all
  select 'insurance_end', ip.id, ip.vehicle_id, v.plate, ip.insurer || ' · ' || ip.policy_number, '',
         (ip.end_date::timestamp at time zone 'Europe/Madrid'), ((ip.end_date + 1)::timestamp at time zone 'Europe/Madrid'), true,
         case when exists (select 1 from public.insurance_policies n where n.renewed_from_id = ip.id and n.archived_at is null) then 'renewed' else 'open' end
  from public.insurance_policies ip join public.vehicles v on v.id = ip.vehicle_id
  where ip.archived_at is null and ip.end_date between p_from and p_to
  union all
  select 'itv', v.id, v.id, v.plate, v.brand || ' ' || v.model, '',
         (v.itv_due_date::timestamp at time zone 'Europe/Madrid'), ((v.itv_due_date + 1)::timestamp at time zone 'Europe/Madrid'), true, 'open'
  from public.vehicles v
  where v.archived_at is null and v.status <> 'sold' and v.itv_due_date between p_from and p_to
  union all
  select 'fine_deadline', f.id, f.vehicle_id, v.plate, f.authority || coalesce(' · ' || f.reference, ''),
         case when f.status = 'pending' and f.identification_deadline between p_from and p_to then 'identification' else 'payment' end,
         (d::timestamp at time zone 'Europe/Madrid'), ((d + 1)::timestamp at time zone 'Europe/Madrid'), true, f.status::text
  from public.traffic_fines f join public.vehicles v on v.id = f.vehicle_id
  cross join lateral (select case when f.status = 'pending' and f.identification_deadline between p_from and p_to then f.identification_deadline
                                  else f.payment_deadline end as d) x
  where f.archived_at is null and f.status in ('pending', 'appealed') and x.d between p_from and p_to
  order by 7
$$;
revoke all on function public.calendar_events(date, date) from public, anon;
grant execute on function public.calendar_events(date, date) to authenticated;

-- Veículos para um período: livres, ocupados ou com ressalvas (manutenção agendada, sem seguro)
create or replace function public.available_vehicles(p_from timestamptz, p_to timestamptz)
returns table (vehicle_id uuid, label text, plate text, category text, daily_price numeric, status public.vehicle_status,
               available boolean, conflict_contract text, maintenance_conflict boolean, insured boolean)
language sql stable security invoker set search_path = ''
as $$
  select v.id, v.brand || ' ' || v.model || coalesce(' ' || v.version, ''), v.plate, v.category, v.daily_price, v.status,
         v.status not in ('maintenance', 'unavailable', 'sold') and c.contract_number is null,
         c.contract_number,
         exists (select 1 from public.maintenance_records m where m.vehicle_id = v.id and m.archived_at is null
                   and m.status in ('scheduled', 'in_progress') and m.blocks_vehicle
                   and coalesce(m.started_at, m.scheduled_date) <= (p_to at time zone 'Europe/Madrid')::date
                   and (m.status = 'in_progress' or m.scheduled_date >= (p_from at time zone 'Europe/Madrid')::date)),
         exists (select 1 from public.insurance_policies ip where ip.vehicle_id = v.id and ip.archived_at is null
                   and ip.start_date <= (p_from at time zone 'Europe/Madrid')::date and ip.end_date >= (p_to at time zone 'Europe/Madrid')::date)
           or exists (select 1 from public.insurance_policies a join public.insurance_policies n on n.renewed_from_id = a.id and n.archived_at is null
                        where a.vehicle_id = v.id and a.archived_at is null
                          and a.start_date <= (p_from at time zone 'Europe/Madrid')::date and n.end_date >= (p_to at time zone 'Europe/Madrid')::date)
  from public.vehicles v
  left join lateral (
    select r.contract_number from public.rentals r
    where r.vehicle_id = v.id and r.archived_at is null and r.status in ('reservation', 'confirmed', 'in_progress', 'late')
      -- em andamento ocupa desde a retirada real até a devolução (ou agora, se atrasado)
      and tstzrange(least(r.pickup_at, coalesce(r.picked_up_at, r.pickup_at)),
                    case when r.status in ('in_progress', 'late') then greatest(r.return_at, now()) else r.return_at end, '[)')
          && tstzrange(p_from, p_to, '[)')
    order by r.pickup_at limit 1
  ) c on true
  where v.archived_at is null and v.status <> 'sold' and p_to > p_from
  order by 7 desc, v.daily_price nulls last, v.plate
$$;
revoke all on function public.available_vehicles(timestamptz, timestamptz) from public, anon;
grant execute on function public.available_vehicles(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default app.current_company_id() references public.companies(id) on delete cascade,
  source       text not null default 'alert' check (source in ('alert', 'event')),
  kind         text not null check (length(kind) <= 60),
  severity     text not null default 'info' check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  title        text not null check (length(title) <= 300),
  entity       text check (entity is null or length(entity) <= 60),
  entity_id    uuid,
  due_date     date,
  dedupe_key   text not null check (length(dedupe_key) <= 200),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  unique (company_id, dedupe_key)
);
create index notifications_open_idx on public.notifications(company_id, created_at desc) where resolved_at is null;

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table public.notification_state (
  company_id   uuid primary key default app.current_company_id() references public.companies(id) on delete cascade,
  refreshed_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_state enable row level security;
create policy notifications_select on public.notifications for select to authenticated using (company_id = app.current_company_id());
create policy notifications_insert on public.notifications for insert to authenticated with check (company_id = app.current_company_id());
create policy notifications_update on public.notifications for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
create policy notification_reads_select on public.notification_reads for select to authenticated using (user_id = auth.uid());
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.notifications n where n.id = notification_id and n.company_id = app.current_company_id()));
create policy notification_reads_delete on public.notification_reads for delete to authenticated using (user_id = auth.uid());
create policy notification_state_all on public.notification_state for all to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
grant select, insert, update on public.notifications to authenticated;
grant select, insert, delete on public.notification_reads to authenticated;
grant select, insert, update on public.notification_state to authenticated;
revoke all on public.notifications, public.notification_reads, public.notification_state from anon;

/**
 * Sincroniza as notificações com os alertas atuais (no máximo a cada p_min_interval).
 * Alertas novos viram notificações; os que deixaram de existir ficam resolvidos.
 */
create or replace function public.refresh_notifications(p_min_interval interval default interval '5 minutes')
returns integer
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_company uuid := app.current_company_id();
  v_last timestamptz;
  v_new integer;
begin
  if v_company is null then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  select refreshed_at into v_last from public.notification_state where company_id = v_company for update;
  if v_last is not null and v_last > now() - p_min_interval then
    return 0;
  end if;
  insert into public.notification_state (company_id, refreshed_at) values (v_company, now())
  on conflict (company_id) do update set refreshed_at = excluded.refreshed_at;

  create temporary table if not exists pg_temp.cur_alerts (kind text, severity text, entity text, entity_id uuid, title text, due_date date, k text) on commit drop;
  delete from pg_temp.cur_alerts;
  insert into pg_temp.cur_alerts
  select a.kind, a.severity, a.entity, a.entity_id, left(a.title, 300), a.due_date,
         left(a.kind || ':' || coalesce(a.entity_id::text, '') || ':' || coalesce(a.due_date::text, ''), 200)
  from (select * from public.dashboard_alerts(100) union all select * from public.extra_alert_rows()) a;

  with ins as (
    insert into public.notifications (company_id, source, kind, severity, title, entity, entity_id, due_date, dedupe_key)
    select distinct on (k) v_company, 'alert', kind, severity, title, entity, entity_id, due_date, k from pg_temp.cur_alerts
    on conflict (company_id, dedupe_key) do update
      set severity = excluded.severity, title = excluded.title, resolved_at = null, updated_at = now()
      where public.notifications.resolved_at is not null
         or (public.notifications.severity, public.notifications.title) is distinct from (excluded.severity, excluded.title)
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into v_new from ins;

  update public.notifications n set resolved_at = now(), updated_at = now()
   where n.company_id = v_company and n.source = 'alert' and n.resolved_at is null
     and not exists (select 1 from pg_temp.cur_alerts c where c.k = n.dedupe_key);
  return v_new;
end;
$$;
revoke all on function public.refresh_notifications(interval) from public, anon;
grant execute on function public.refresh_notifications(interval) to authenticated;

-- Não lidas (abertas) do usuário atual
create or replace function public.unread_notifications()
returns integer
language sql stable security invoker set search_path = ''
as $$
  select count(*)::integer from public.notifications n
  where n.resolved_at is null
    and not exists (select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())
$$;
revoke all on function public.unread_notifications() from public, anon;
grant execute on function public.unread_notifications() to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql volatile security invoker set search_path = ''
as $$
  with ins as (
    insert into public.notification_reads (notification_id, user_id)
    select n.id, auth.uid() from public.notifications n
    where (p_ids is null and n.resolved_at is null) or n.id = any (p_ids)
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from ins
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Área do cliente
-- ---------------------------------------------------------------------
create table public.customer_portal_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete cascade,
  customer_id   uuid not null unique references public.customers(id) on delete cascade,
  email         text not null,
  invited_at    timestamptz not null default now(),
  invited_by    uuid references auth.users(id) on delete set null,
  last_seen_at  timestamptz,
  disabled_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function app.guard_portal_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- quem é da equipe não pode ser cliente do portal (e vice-versa)
  if exists (select 1 from public.profiles p where p.id = new.user_id) then
    raise exception 'PORTAL_STAFF_CONFLICT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id
                   and c.archived_at is null and c.anonymized_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and (new.user_id, new.customer_id, new.company_id) is distinct from (old.user_id, old.customer_id, old.company_id) then
    raise exception 'PORTAL_LOCKED' using errcode = 'P0001';
  end if;
  new.email := lower(trim(new.email));
  return new;
end;
$$;
create trigger customer_portal_accounts_guard before insert or update on public.customer_portal_accounts
  for each row execute function app.guard_portal_account();

-- impede que uma conta do portal vire perfil da equipe
create or replace function app.guard_profile_not_portal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.customer_portal_accounts a where a.user_id = new.id) then
    raise exception 'PORTAL_STAFF_CONFLICT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger profiles_not_portal before insert on public.profiles
  for each row execute function app.guard_profile_not_portal();

alter table public.customer_portal_accounts enable row level security;
create policy portal_accounts_select on public.customer_portal_accounts for select to authenticated using (company_id = app.current_company_id());
create policy portal_accounts_insert on public.customer_portal_accounts for insert to authenticated with check (company_id = app.current_company_id());
create policy portal_accounts_update on public.customer_portal_accounts for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
grant select, insert, update on public.customer_portal_accounts to authenticated;
revoke all on public.customer_portal_accounts from anon;
-- ativação/desativação registradas pela aplicação (log_event 'portal.invited' / 'portal.disabled')

-- anonimização encerra o acesso
create or replace function app.after_customer_anonymized()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.anonymized_at is not null and old.anonymized_at is null then
    update public.customer_portal_accounts set disabled_at = coalesce(disabled_at, now()) where customer_id = new.id;
  end if;
  return null;
end;
$$;
create trigger customers_portal_anonymized after update of anonymized_at on public.customers
  for each row execute function app.after_customer_anonymized();

-- Cliente do portal autenticado (null para equipe/anônimo/desativado)
create or replace function app.portal_account()
returns public.customer_portal_accounts
language sql stable security definer set search_path = ''
as $$
  select a.* from public.customer_portal_accounts a
  join public.customers c on c.id = a.customer_id
  where a.user_id = auth.uid() and a.disabled_at is null and c.archived_at is null and c.anonymized_at is null
$$;

create or replace function app.require_portal()
returns public.customer_portal_accounts
language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts;
begin
  a := app.portal_account();
  if a.user_id is null then
    raise exception 'PORTAL_FORBIDDEN' using errcode = '42501';
  end if;
  return a;
end;
$$;

create or replace function public.portal_me()
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts := app.require_portal();
  v jsonb;
begin
  update public.customer_portal_accounts set last_seen_at = now() where user_id = a.user_id
    and (last_seen_at is null or last_seen_at < now() - interval '10 minutes');
  select jsonb_build_object(
    'customer_id', c.id,
    'name', case when c.customer_type = 'company' then c.company_name else c.full_name end,
    'customer_type', c.customer_type,
    'email', c.email, 'phone', c.phone,
    'driving_licence_expiry', c.driving_licence_expiry,
    'company', jsonb_build_object('name', co.name, 'legal_name', co.legal_name, 'phone', co.phone, 'email', co.email,
                                  'address', co.address, 'city', co.city, 'logo', co.logo_path is not null, 'default_locale', co.default_locale)
  ) into v
  from public.customers c join public.companies co on co.id = c.company_id
  where c.id = a.customer_id;
  return v;
end;
$$;

create or replace function public.portal_rentals()
returns table (id uuid, contract_number text, status public.rental_status, pickup_at timestamptz, return_at timestamptz,
               actual_return_at timestamptz, vehicle text, plate text, pickup_location text, return_location text,
               total_amount numeric, paid numeric, balance numeric, deposit_amount numeric, deposit_status text,
               deposit_balance numeric, signature_status text, contract_locale text)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.contract_number, r.status, r.pickup_at, r.return_at, r.actual_return_at,
         v.brand || ' ' || v.model, v.plate, r.pickup_location, r.return_location,
         r.total_amount, coalesce(p.paid, 0)::numeric(14,2), greatest(r.total_amount - coalesce(p.paid, 0), 0)::numeric(14,2),
         r.deposit_amount, d.status, d.balance, r.signature_status::text, r.contract_locale::text
  from public.rentals r
  join public.vehicles v on v.id = r.vehicle_id
  left join public.deposits d on d.rental_id = r.id
  left join (select rental_id, sum(case when kind = 'payment' then amount else -amount end) as paid
               from public.rental_payments where voided_at is null group by rental_id) p on p.rental_id = r.id
  where r.customer_id = (app.require_portal()).customer_id and r.archived_at is null
  order by r.pickup_at desc
$$;

create or replace function public.portal_rental_payments(p_rental uuid)
returns table (kind text, amount numeric, paid_at date, method text)
language sql stable security definer set search_path = ''
as $$
  select rp.kind::text, rp.amount, rp.paid_at, rp.method::text
  from public.rental_payments rp join public.rentals r on r.id = rp.rental_id
  where rp.rental_id = p_rental and rp.voided_at is null
    and r.customer_id = (app.require_portal()).customer_id and r.archived_at is null
  order by rp.paid_at
$$;

create or replace function public.portal_documents()
returns table (kind text, id uuid, title text, category text, expires_at date, created_at timestamptz, contract_number text)
language sql stable security definer set search_path = ''
as $$
  select 'customer-doc', cd.id, cd.title, cd.doc_type::text, cd.expires_at, cd.created_at, null::text
  from public.customer_documents cd
  where cd.customer_id = (app.require_portal()).customer_id and cd.archived_at is null
  union all
  select 'rental-doc', d.id, d.title, d.category::text, d.expires_at, d.created_at, r.contract_number
  from public.documents d join public.rentals r on r.id = d.rental_id
  where r.customer_id = (app.require_portal()).customer_id and d.archived_at is null and d.category in ('contract', 'receipt', 'invoice')
  order by 6 desc
$$;

create or replace function public.portal_fines()
returns table (kind text, id uuid, occurred_at timestamptz, description text, plate text, contract_number text,
               status text, amount numeric, charged numeric, charged_paid_at date)
language sql stable security definer set search_path = ''
as $$
  select 'fine', f.id, f.infraction_at, f.infraction || ' · ' || f.authority, v.plate, r.contract_number,
         f.status::text, f.amount, f.recharge_amount, f.recharge_paid_at
  from public.traffic_fines f join public.vehicles v on v.id = f.vehicle_id left join public.rentals r on r.id = f.rental_id
  where f.customer_id = (app.require_portal()).customer_id and f.archived_at is null and f.status <> 'cancelled'
  union all
  select 'accident', a.id, a.occurred_at, a.description, v.plate, r.contract_number,
         a.status::text, null, a.deductible_amount, a.deductible_paid_at
  from public.accidents a join public.vehicles v on v.id = a.vehicle_id left join public.rentals r on r.id = a.rental_id
  where a.customer_id = (app.require_portal()).customer_id and a.archived_at is null and a.status <> 'rejected'
  order by 3 desc
$$;

-- Caminho de arquivo do próprio cliente (para link temporário gerado pelo servidor); aberturas ficam registradas
create or replace function public.portal_file_path(p_kind text, p_id uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts := app.require_portal();
  v_path text;
  v_entity text;
begin
  if p_kind = 'customer-doc' then
    select storage_path into v_path from public.customer_documents where id = p_id and customer_id = a.customer_id and archived_at is null;
    v_entity := 'customer_documents';
  elsif p_kind = 'rental-doc' then
    select d.storage_path into v_path from public.documents d join public.rentals r on r.id = d.rental_id
     where d.id = p_id and r.customer_id = a.customer_id and d.archived_at is null and d.category in ('contract', 'receipt', 'invoice');
    v_entity := 'documents';
  end if;
  if v_path is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (a.company_id, a.user_id, 'portal.file_downloaded', v_entity, p_id::text, jsonb_build_object('customer_id', a.customer_id));
  return v_path;
end;
$$;

-- O contrato pertence ao cliente do portal?
create or replace function public.portal_owns_rental(p_rental uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.rentals r where r.id = p_rental and r.archived_at is null
                   and r.status <> 'cancelled' and r.customer_id = (app.portal_account()).customer_id)
$$;

do $$
declare f text;
begin
  foreach f in array array['portal_me()', 'portal_rentals()', 'portal_rental_payments(uuid)', 'portal_documents()', 'portal_fines()',
                           'portal_file_path(text, uuid)', 'portal_owns_rental(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Localiza um usuário de autenticação pelo e-mail (uso exclusivo do servidor ao ativar o portal)
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1
$$;
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Solicitações de reserva pelo portal
-- ---------------------------------------------------------------------
create table public.rental_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  pickup_at     timestamptz not null,
  return_at     timestamptz not null,
  vehicle_preference text check (vehicle_preference is null or length(vehicle_preference) <= 160),
  notes         text check (notes is null or length(notes) <= 1000),
  status        text not null default 'new' check (status in ('new', 'contacted', 'converted', 'declined')),
  rental_id     uuid references public.rentals(id) on delete set null,
  handled_by    uuid references auth.users(id) on delete set null,
  handled_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint rental_requests_dates_chk check (return_at > pickup_at)
);
create index rental_requests_company_idx on public.rental_requests(company_id, status, created_at desc);
alter table public.rental_requests enable row level security;
create policy rental_requests_select on public.rental_requests for select to authenticated using (company_id = app.current_company_id());
create policy rental_requests_update on public.rental_requests for update to authenticated
  using (company_id = app.current_company_id()) with check (company_id = app.current_company_id());
grant select, update on public.rental_requests to authenticated;
revoke all on public.rental_requests from anon;
create trigger rental_requests_log after insert or update on public.rental_requests
  for each row execute function app.log_activity();

create or replace function app.guard_rental_request()
returns trigger
language plpgsql
as $$
begin
  if (new.company_id, new.customer_id, new.pickup_at, new.return_at, new.user_id) is distinct from
     (old.company_id, old.customer_id, old.pickup_at, old.return_at, old.user_id) then
    raise exception 'REQUEST_LOCKED' using errcode = 'P0001';
  end if;
  if new.status <> old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  if new.rental_id is not null and not exists (select 1 from public.rentals r where r.id = new.rental_id and r.customer_id = new.customer_id) then
    raise exception 'LINK_MISMATCH' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger rental_requests_guard before update on public.rental_requests
  for each row execute function app.guard_rental_request();

create or replace function public.portal_request_rental(p_pickup timestamptz, p_return timestamptz, p_preference text, p_notes text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.customer_portal_accounts := app.require_portal();
  v_id uuid;
  v_name text;
begin
  if p_pickup < now() - interval '1 hour' or p_return <= p_pickup or p_return > now() + interval '2 years' then
    raise exception 'INVALID_PERIOD' using errcode = 'P0001';
  end if;
  if (select count(*) from public.rental_requests where customer_id = a.customer_id and status in ('new', 'contacted')) >= 5 then
    raise exception 'TOO_MANY_REQUESTS' using errcode = 'P0001';
  end if;
  insert into public.rental_requests (company_id, customer_id, user_id, pickup_at, return_at, vehicle_preference, notes)
  values (a.company_id, a.customer_id, a.user_id, p_pickup, p_return, nullif(left(trim(p_preference), 160), ''), nullif(left(trim(p_notes), 1000), ''))
  returning id into v_id;
  select case when customer_type = 'company' then company_name else full_name end into v_name from public.customers where id = a.customer_id;
  insert into public.notifications (company_id, source, kind, severity, title, entity, entity_id, due_date, dedupe_key)
  values (a.company_id, 'event', 'rental_request', 'high', coalesce(v_name, '') || ' · ' ||
            to_char(p_pickup at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ' → ' || to_char(p_return at time zone 'Europe/Madrid', 'DD/MM/YYYY'),
          'rental_requests', v_id, (p_pickup at time zone 'Europe/Madrid')::date, 'request:' || v_id);
  return v_id;
end;
$$;
revoke all on function public.portal_request_rental(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.portal_request_rental(timestamptz, timestamptz, text, text) to authenticated;

create or replace function public.portal_requests()
returns table (id uuid, pickup_at timestamptz, return_at timestamptz, vehicle_preference text, notes text, status text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select id, pickup_at, return_at, vehicle_preference, notes, status, created_at from public.rental_requests
  where customer_id = (app.require_portal()).customer_id order by created_at desc limit 20
$$;
revoke all on function public.portal_requests() from public, anon;
grant execute on function public.portal_requests() to authenticated;

-- solicitação tratada → notificação resolvida
create or replace function app.after_request_handled()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status in ('converted', 'declined') and old.status not in ('converted', 'declined') then
    update public.notifications set resolved_at = now(), updated_at = now()
     where company_id = new.company_id and dedupe_key = 'request:' || new.id and resolved_at is null;
  end if;
  return null;
end;
$$;
create trigger rental_requests_after after update on public.rental_requests
  for each row execute function app.after_request_handled();

-- eventos do portal no registro de atividades
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('user.invite', 'user.password_link', 'user.sessions_revoked', 'company.logo_updated',
                      'customer.anonymized', 'file.downloaded', 'report.generated', 'portal.invited', 'portal.disabled') then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (app.current_company_id(), auth.uid(), p_action, left(p_entity, 60), left(p_entity_id, 100), p_details);
end;
$$;

-- Arquivos do próprio cliente no Storage (links temporários gerados com a sessão do cliente)
create policy documents_bucket_portal_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (app.portal_account()).customer_id is not null
    and (
      exists (select 1 from public.customer_documents cd
               where cd.storage_path = name and cd.archived_at is null and cd.customer_id = (app.portal_account()).customer_id)
      or exists (select 1 from public.documents d join public.rentals r on r.id = d.rental_id
                  where d.storage_path = name and d.archived_at is null and d.category in ('contract', 'receipt', 'invoice')
                    and r.customer_id = (app.portal_account()).customer_id)
    )
  );
