-- =====================================================================
-- JB RENT PRO — Migration 0002: usuários, permissões e configurações
-- ---------------------------------------------------------------------
--   * provisionamento de perfil quando o servidor (service_role) define
--     company_id/role em app_metadata de um usuário convidado
--   * proteção: sempre existe ao menos um ADMINISTRADOR PRINCIPAL ativo
--   * e-mail do perfil só muda pelo sistema
--   * configurações da empresa: dados fiscais, contrato, preços padrão,
--     quilometragem, catálogo de taxas adicionais, filiais (futuro)
--   * histórico de acessos com IP e user-agent
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configurações da empresa
-- ---------------------------------------------------------------------
alter table public.companies
  add column website                text,
  add column iban                   text,
  add column fiscal_notes           text,                -- observações do gestor/assessor fiscal
  add column prices_include_vat     boolean not null default true,
  add column default_daily_price    numeric(10,2) check (default_daily_price >= 0),
  add column default_weekly_price   numeric(10,2) check (default_weekly_price >= 0),
  add column default_monthly_price  numeric(10,2) check (default_monthly_price >= 0),
  add column default_deposit_amount numeric(12,2) check (default_deposit_amount >= 0),
  add column default_mileage_policy public.mileage_policy not null default 'unlimited',
  add column default_mileage_limit_km integer check (default_mileage_limit_km >= 0),
  add column default_excess_km_price numeric(8,2) check (default_excess_km_price >= 0),
  add column rental_conditions_pt   text,
  add column rental_conditions_es   text,
  add column contract_footer        text,
  add column document_retention_years smallint check (document_retention_years between 1 and 30),
  add constraint companies_mileage_chk
    check (default_mileage_policy = 'unlimited' or default_mileage_limit_km is not null);

-- Catálogo de taxas adicionais (cadeirinha, condutor adicional, entrega...)
create type public.fee_charge_type as enum ('per_rental', 'per_day');

create table public.fee_catalog (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default app.current_company_id() references public.companies(id) on delete cascade,
  name_pt      text not null check (length(trim(name_pt)) between 1 and 120),
  name_es      text not null check (length(trim(name_es)) between 1 and 120),
  amount       numeric(10,2) not null check (amount >= 0),
  charge_type  public.fee_charge_type not null default 'per_rental',
  vat_rate     numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100),
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null
);
create index fee_catalog_company_idx on public.fee_catalog(company_id, sort_order);

-- Filiais (estrutura preparada para expansão)
create table public.branches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default app.current_company_id() references public.companies(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  address      text,
  city         text,
  phone        text,
  is_main      boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null
);
create unique index branches_one_main_uidx on public.branches(company_id) where is_main and archived_at is null;

create trigger fee_catalog_audit before insert or update on public.fee_catalog
  for each row execute function app.set_audit_fields();
create trigger branches_audit before insert or update on public.branches
  for each row execute function app.set_audit_fields();
create trigger fee_catalog_log after insert or update or delete on public.fee_catalog
  for each row execute function app.log_activity();
create trigger branches_log after insert or update or delete on public.branches
  for each row execute function app.log_activity();

alter table public.fee_catalog enable row level security;
alter table public.branches enable row level security;

-- Equipe lê; somente o administrador principal configura
create policy fee_catalog_select on public.fee_catalog for select to authenticated
  using (company_id = app.current_company_id());
create policy fee_catalog_write on public.fee_catalog for all to authenticated
  using (company_id = app.current_company_id() and app.is_owner())
  with check (company_id = app.current_company_id() and app.is_owner());
create policy branches_select on public.branches for select to authenticated
  using (company_id = app.current_company_id());
create policy branches_write on public.branches for all to authenticated
  using (company_id = app.current_company_id() and app.is_owner())
  with check (company_id = app.current_company_id() and app.is_owner());

grant select, insert, update, delete on public.fee_catalog, public.branches to authenticated;
revoke all on public.fee_catalog, public.branches from anon;

-- ---------------------------------------------------------------------
-- Provisionamento de perfil para usuários convidados.
-- O convite (Supabase Auth) cria o usuário sem metadados; em seguida o
-- servidor grava company_id/role em app_metadata (somente service_role
-- consegue). Este trigger cria o perfil nesse momento.
-- ---------------------------------------------------------------------
create or replace function app.handle_user_app_metadata()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_role public.user_role;
begin
  if new.raw_app_meta_data is not distinct from old.raw_app_meta_data then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = new.id) then
    return new; -- perfil existente: cargo/empresa só mudam pela aplicação (com auditoria)
  end if;
  begin
    v_company := (new.raw_app_meta_data ->> 'company_id')::uuid;
  exception when others then
    return new;
  end;
  if v_company is null or not exists (select 1 from public.companies c where c.id = v_company) then
    return new;
  end if;
  v_role := case when new.raw_app_meta_data ->> 'role' = 'owner' then 'owner' else 'admin' end;
  insert into public.profiles (id, company_id, role, email, full_name)
  values (new.id, v_company, v_role, coalesce(new.email, ''),
          nullif(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_app_metadata
  after update of raw_app_meta_data on auth.users
  for each row execute function app.handle_user_app_metadata();

-- ---------------------------------------------------------------------
-- Guardas de perfil
-- ---------------------------------------------------------------------
create or replace function app.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new; -- service_role / migrations
  end if;
  if (new.role is distinct from old.role
      or new.company_id is distinct from old.company_id
      or new.is_active is distinct from old.is_active)
     and not app.is_owner() then
    raise exception 'PERMISSION_DENIED: only the main administrator can change roles'
      using errcode = '42501';
  end if;
  if new.company_id is distinct from old.company_id then
    raise exception 'PERMISSION_DENIED: company cannot be changed' using errcode = '42501';
  end if;
  if new.email is distinct from old.email then
    raise exception 'PERMISSION_DENIED: email is managed by authentication' using errcode = '42501';
  end if;
  if old.id = auth.uid() and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'PERMISSION_DENIED: owner cannot demote itself' using errcode = '42501';
  end if;
  if old.id = auth.uid() and old.is_active and not new.is_active then
    raise exception 'PERMISSION_DENIED: cannot deactivate yourself' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Sempre pelo menos um administrador principal ativo por empresa
create or replace function app.ensure_active_owner()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner' and old.is_active
     and (new.role <> 'owner' or not new.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.company_id = old.company_id and p.id <> old.id
         and p.role = 'owner' and p.is_active
     ) then
    raise exception 'LAST_OWNER: company must keep an active main administrator'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- nome ordenado após "profiles_guard" para que a guarda de permissões rode primeiro
create trigger profiles_guard_last_owner before update on public.profiles
  for each row execute function app.ensure_active_owner();

-- ---------------------------------------------------------------------
-- Histórico de acessos com IP
-- ---------------------------------------------------------------------
drop function if exists public.log_sign_in(text);

create or replace function public.log_sign_in(p_user_agent text default null, p_ip text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_ip inet;
begin
  if auth.uid() is null then
    return;
  end if;
  begin
    v_ip := nullif(trim(split_part(p_ip, ',', 1)), '')::inet;
  exception when others then
    v_ip := null;
  end;
  update public.profiles set last_sign_in_at = now() where id = auth.uid();
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, ip_address, user_agent)
  values (app.current_company_id(), auth.uid(), 'auth.login', 'auth', auth.uid()::text,
          v_ip, left(p_user_agent, 500));
end;
$$;
revoke all on function public.log_sign_in(text, text) from public, anon;
grant execute on function public.log_sign_in(text, text) to authenticated;

create index activity_logs_user_idx on public.activity_logs(user_id, created_at desc);
create index activity_logs_action_idx on public.activity_logs(company_id, action, created_at desc);

-- ---------------------------------------------------------------------
-- Eventos administrativos que não passam por triggers de tabela
-- (convite enviado, link de senha enviado...). O autor é sempre o
-- usuário autenticado; apenas ações da lista permitida.
-- ---------------------------------------------------------------------
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.is_staff() then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_action not in ('user.invite', 'user.password_link', 'user.sessions_revoked', 'company.logo_updated') then
    raise exception 'INVALID_EVENT' using errcode = '22023';
  end if;
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (app.current_company_id(), auth.uid(), p_action, left(p_entity, 60), left(p_entity_id, 100), p_details);
end;
$$;
revoke all on function public.log_event(text, text, text, jsonb) from public, anon;
grant execute on function public.log_event(text, text, text, jsonb) to authenticated;
