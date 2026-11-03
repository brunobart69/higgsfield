-- =====================================================================
-- JB RENT PRO — Instalação no Supabase: lote 1 de 3
-- Cole TODO o conteúdo no SQL Editor e clique em Run. Depois rode o lote 2.
-- Contém: 20261103000001_core_schema.sql, 20261104000001_users_settings.sql, 20261105000001_vehicles_customers.sql, 20261106000001_rentals.sql, 20261107000001_inspections_damages.sql, 20261108000001_insurance_documents.sql, 20261109000001_finance_categories.sql
-- (gerado a partir de supabase/migrations — não edite aqui)
-- =====================================================================

-- >>>>> 20261103000001_core_schema.sql
-- =====================================================================
-- JB RENT PRO — Migration 0001: núcleo do sistema
-- ---------------------------------------------------------------------
-- Conteúdo:
--   * extensões, schema "app" com funções auxiliares de segurança
--   * companies, profiles (vinculados a auth.users)
--   * vehicles, vehicle_valuations, customers, rentals
--   * insurance_policies, documents, financial_transactions
--   * activity_logs (auditoria automática por trigger)
--   * RLS em todas as tabelas
--   * restrição de exclusão (EXCLUDE) que impede reservas sobrepostas
--   * RPCs do dashboard (cálculos em NUMERIC, nunca float)
--
-- Valores monetários: numeric(12,2). Identificadores: uuid.
-- Datas/horas: timestamptz (armazenadas em UTC, exibidas em Europe/Madrid).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;
grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
create type public.user_role as enum ('owner', 'admin');

create type public.vehicle_status as enum
  ('available', 'reserved', 'rented', 'maintenance', 'unavailable', 'sold');

create type public.fuel_type as enum
  ('gasoline', 'diesel', 'hybrid', 'plugin_hybrid', 'electric', 'lpg', 'other');

create type public.transmission_type as enum ('manual', 'automatic');

create type public.customer_type as enum ('individual', 'company');

create type public.rental_status as enum
  ('reservation', 'confirmed', 'in_progress', 'completed', 'late', 'cancelled');

create type public.rental_pricing_mode as enum ('daily', 'weekly', 'monthly', 'custom');

create type public.mileage_policy as enum ('unlimited', 'daily', 'weekly', 'monthly', 'custom');

create type public.transaction_type as enum ('income', 'expense');

create type public.transaction_category as enum (
  -- receitas
  'rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income',
  -- despesas
  'vehicle_purchase', 'insurance', 'maintenance', 'itv', 'tax', 'cleaning',
  'tyres', 'fuel', 'documentation', 'commission', 'other_expense'
);

create type public.transaction_status as enum ('pending', 'paid', 'cancelled');

create type public.payment_method as enum
  ('cash', 'card', 'bank_transfer', 'bizum', 'direct_debit', 'other');

create type public.document_category as enum (
  'insurance_policy', 'contract', 'vehicle_document', 'technical_sheet',
  'circulation_permit', 'itv', 'invoice', 'receipt', 'inspection',
  'customer_id', 'driving_licence', 'other'
);

-- ---------------------------------------------------------------------
-- Empresas (preparado para multiempresa / filiais futuras)
-- ---------------------------------------------------------------------
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 200),
  legal_name       text,
  tax_id           text,                      -- NIF/CIF
  address          text,
  city             text,
  postal_code      text,
  province         text,
  country          char(2) not null default 'ES',
  phone            text,
  email            text,
  logo_path        text,                      -- caminho no Storage (bucket privado)
  default_locale   text not null default 'pt-BR' check (default_locale in ('pt-BR', 'es-ES')),
  currency         char(3) not null default 'EUR',
  timezone         text not null default 'Europe/Madrid',
  vat_rate         numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100),
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------
-- Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  company_id       uuid not null references public.companies(id) on delete restrict,
  role             public.user_role not null default 'admin',
  full_name        text,
  email            text not null,
  phone            text,
  locale           text not null default 'pt-BR' check (locale in ('pt-BR', 'es-ES')),
  is_active        boolean not null default true,
  last_sign_in_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_company_idx on public.profiles(company_id);

-- ---------------------------------------------------------------------
-- Funções auxiliares de segurança (SECURITY DEFINER evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function app.current_company_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.company_id from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function app.user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;

create or replace function app.is_owner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'owner'
  )
$$;

grant execute on all functions in schema app to authenticated;

-- ---------------------------------------------------------------------
-- Triggers genéricos: updated_at / autoria
-- ---------------------------------------------------------------------
create or replace function app.set_audit_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_audit before insert or update on public.companies
  for each row execute function app.set_audit_fields();
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Impede que um administrador altere o próprio cargo/empresa
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
  -- o proprietário não pode rebaixar a si próprio (evita empresa sem dono)
  if old.id = auth.uid() and old.role = 'owner' and new.role <> 'owner' then
    raise exception 'PERMISSION_DENIED: owner cannot demote itself' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

-- ---------------------------------------------------------------------
-- Novo usuário em auth.users → perfil
--   * 1º usuário do sistema: cria a empresa e vira ADMINISTRADOR PRINCIPAL
--   * demais: só recebem perfil se convidados pelo servidor (service_role),
--     que grava company_id e role em raw_app_meta_data (o usuário NÃO
--     consegue alterar app_metadata). Sem convite → sem acesso.
-- ---------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_role public.user_role;
begin
  if not exists (select 1 from public.companies) then
    insert into public.companies (name, created_by, updated_by)
    values ('JB RENT', new.id, new.id)
    returning id into v_company;
    v_role := 'owner';
  else
    begin
      v_company := (new.raw_app_meta_data ->> 'company_id')::uuid;
    exception when others then
      v_company := null;
    end;
    if v_company is null
       or not exists (select 1 from public.companies c where c.id = v_company) then
      return new; -- usuário sem convite: nenhum acesso ao painel
    end if;
    v_role := case when new.raw_app_meta_data ->> 'role' = 'owner' then 'owner' else 'admin' end;
  end if;

  insert into public.profiles (id, company_id, role, email, full_name)
  values (
    new.id, v_company, v_role, coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------
-- Registro de atividades (auditoria)
-- ---------------------------------------------------------------------
create table public.activity_logs (
  id           bigint generated always as identity primary key,
  company_id   uuid references public.companies(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  action       text not null,              -- insert | update | delete | auth.login | ...
  entity       text not null,              -- nome da tabela / entidade
  entity_id    text,
  changes      jsonb,                      -- {campo: {old, new}}
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index activity_logs_company_created_idx on public.activity_logs(company_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs(entity, entity_id);

create or replace function app.log_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_company uuid;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if v_key not in ('updated_at', 'updated_by', 'last_sign_in_at')
         and (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_diff := v_diff || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return null; -- nada relevante mudou
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := v_new;
  else
    v_diff := v_old;
  end if;

  v_company := coalesce((v_new ->> 'company_id')::uuid, (v_old ->> 'company_id')::uuid);
  if tg_table_name = 'companies' then
    v_company := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, changes)
  values (v_company, auth.uid(), lower(tg_op), tg_table_name, v_id, v_diff);
  return null;
end;
$$;

-- Registro de login (chamado pelo servidor após autenticação bem-sucedida)
create or replace function public.log_sign_in(p_user_agent text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.profiles set last_sign_in_at = now() where id = auth.uid();
  insert into public.activity_logs (company_id, user_id, action, entity, entity_id, user_agent)
  values (app.current_company_id(), auth.uid(), 'auth.login', 'auth', auth.uid()::text,
          left(p_user_agent, 500));
end;
$$;
revoke all on function public.log_sign_in(text) from public, anon;
grant execute on function public.log_sign_in(text) to authenticated;

-- Bloqueio de exclusão definitiva (registros financeiros e contratos).
-- Só é permitida quando o ADMINISTRADOR PRINCIPAL ativa explicitamente
-- a autorização especial na mesma transação:
--   select set_config('app.allow_hard_delete', 'on', true);
create or replace function app.prevent_hard_delete()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return old; -- service_role / manutenção do banco
  end if;
  if coalesce(current_setting('app.allow_hard_delete', true), 'off') = 'on' and app.is_owner() then
    return old;
  end if;
  raise exception 'HARD_DELETE_FORBIDDEN: archive the record instead' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------
-- Veículos
-- ---------------------------------------------------------------------
create table public.vehicles (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null default app.current_company_id()
                          references public.companies(id) on delete restrict,
  -- identificação
  brand                 text not null check (length(trim(brand)) > 0),
  model                 text not null check (length(trim(model)) > 0),
  version               text,
  year                  smallint check (year between 1950 and 2100),
  plate                 text not null check (length(trim(plate)) > 0),   -- matrícula
  vin                   text check (vin is null or length(vin) = 17),
  color                 text,
  vehicle_type          text,                                            -- turismo, SUV, furgoneta...
  fuel                  public.fuel_type,
  transmission          public.transmission_type,
  doors                 smallint check (doors between 1 and 9),
  seats                 smallint check (seats between 1 and 60),
  -- operacional
  current_mileage       integer not null default 0 check (current_mileage >= 0),
  acquisition_date      date,
  purchase_price        numeric(12,2) check (purchase_price >= 0),
  market_value          numeric(12,2) check (market_value >= 0),
  fleet_entry_date      date,
  fleet_exit_date       date,
  category              text,
  daily_price           numeric(10,2) check (daily_price >= 0),
  weekly_price          numeric(10,2) check (weekly_price >= 0),
  monthly_price         numeric(10,2) check (monthly_price >= 0),
  -- documentação
  itv_due_date          date,
  circulation_permit_path text,
  technical_sheet_path  text,
  main_photo_path       text,
  status                public.vehicle_status not null default 'available',
  notes                 text,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  constraint vehicles_fleet_dates_chk check (fleet_exit_date is null or fleet_entry_date is null or fleet_exit_date >= fleet_entry_date)
);
create unique index vehicles_company_plate_uidx on public.vehicles(company_id, upper(replace(plate, ' ', '')));
create unique index vehicles_company_vin_uidx on public.vehicles(company_id, upper(vin)) where vin is not null;
create index vehicles_company_status_idx on public.vehicles(company_id, status) where archived_at is null;
create index vehicles_itv_idx on public.vehicles(company_id, itv_due_date) where archived_at is null;

-- Histórico de valor de mercado (evolução patrimonial)
create table public.vehicle_valuations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id    uuid not null references public.vehicles(id) on delete cascade,
  valuation_date date not null,
  value         numeric(12,2) not null check (value >= 0),
  source        text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  unique (vehicle_id, valuation_date)
);
create index vehicle_valuations_vehicle_idx on public.vehicle_valuations(vehicle_id, valuation_date desc);

-- ---------------------------------------------------------------------
-- Clientes (pessoa física e jurídica)
-- ---------------------------------------------------------------------
create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  customer_type       public.customer_type not null,
  -- pessoa física
  full_name           text,
  birth_date          date,
  id_document_type    text check (id_document_type is null or id_document_type in ('dni', 'nie', 'passport', 'other')),
  id_document_number  text,
  driving_licence_number text,
  driving_licence_expiry date,
  -- pessoa jurídica
  company_name        text,
  legal_name          text,
  tax_id              text,                    -- CIF/NIF
  representative_name text,
  billing_details     jsonb not null default '{}'::jsonb,
  -- contato
  address             text,
  city                text,
  postal_code         text,
  country             char(2) default 'ES',
  phone               text,
  email               text,
  notes               text,
  -- RGPD
  gdpr_consent_at     timestamptz,
  marketing_consent   boolean not null default false,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_by          uuid references auth.users(id) on delete set null,
  constraint customers_identity_chk check (
    (customer_type = 'individual' and full_name is not null and length(trim(full_name)) > 0)
    or (customer_type = 'company' and company_name is not null and length(trim(company_name)) > 0)
  )
);
create index customers_company_idx on public.customers(company_id) where archived_at is null;
create index customers_doc_idx on public.customers(company_id, upper(id_document_number));
create index customers_tax_idx on public.customers(company_id, upper(tax_id));

-- ---------------------------------------------------------------------
-- Aluguéis / contratos  (reservas = aluguéis com status 'reservation')
-- ---------------------------------------------------------------------
create sequence public.rental_number_seq;

create table public.rentals (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  contract_number       text not null default
                          ('JB-' || to_char(now() at time zone 'Europe/Madrid', 'YYYY') || '-' ||
                           lpad(nextval('public.rental_number_seq')::text, 5, '0')),
  customer_id           uuid not null references public.customers(id) on delete restrict,
  vehicle_id            uuid not null references public.vehicles(id) on delete restrict,
  status                public.rental_status not null default 'reservation',
  pickup_at             timestamptz not null,
  return_at             timestamptz not null,
  actual_return_at      timestamptz,
  pricing_mode          public.rental_pricing_mode not null default 'daily',
  unit_price            numeric(10,2) not null check (unit_price >= 0),
  discount_amount       numeric(12,2) not null default 0 check (discount_amount >= 0),
  extra_fees_amount     numeric(12,2) not null default 0 check (extra_fees_amount >= 0),
  total_amount          numeric(12,2) not null default 0 check (total_amount >= 0),
  deposit_amount        numeric(12,2) not null default 0 check (deposit_amount >= 0),
  payment_method        public.payment_method,
  mileage_policy        public.mileage_policy not null default 'unlimited',
  mileage_limit_km      integer check (mileage_limit_km is null or mileage_limit_km >= 0),
  excess_km_price       numeric(8,2) check (excess_km_price is null or excess_km_price >= 0),
  start_mileage         integer check (start_mileage >= 0),
  end_mileage           integer check (end_mileage >= 0),
  start_fuel_level      smallint check (start_fuel_level between 0 and 100),
  end_fuel_level        smallint check (end_fuel_level between 0 and 100),
  contract_locale       text not null default 'es-ES' check (contract_locale in ('pt-BR', 'es-ES')),
  signature_status      text not null default 'unsigned'
                          check (signature_status in ('unsigned', 'pending', 'signed')), -- futura assinatura eletrônica
  signature_provider_ref text,
  notes                 text,
  cancelled_reason      text,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  constraint rentals_period_chk check (return_at > pickup_at),
  constraint rentals_mileage_chk check (end_mileage is null or start_mileage is null or end_mileage >= start_mileage),
  constraint rentals_limit_chk check (mileage_policy = 'unlimited' or mileage_limit_km is not null),
  constraint rentals_contract_number_uniq unique (company_id, contract_number),
  -- IMPEDE RESERVAS CONFLITANTES no próprio banco de dados
  constraint rentals_no_overlap exclude using gist (
    vehicle_id with =,
    tstzrange(pickup_at, return_at, '[)') with &&
  ) where (status in ('reservation', 'confirmed', 'in_progress', 'late') and archived_at is null)
);
create index rentals_company_status_idx on public.rentals(company_id, status);
create index rentals_vehicle_period_idx on public.rentals(vehicle_id, pickup_at, return_at);
create index rentals_customer_idx on public.rentals(customer_id);
create index rentals_return_idx on public.rentals(company_id, return_at)
  where status in ('confirmed', 'in_progress', 'late');

-- Compatibilidade com o modelo solicitado: "reservations" é uma visão de rentals
create view public.reservations with (security_invoker = true) as
  select * from public.rentals where status = 'reservation';

-- Valida veículo/cliente da mesma empresa e veículo disponível para aluguel
create or replace function app.validate_rental()
returns trigger
language plpgsql
as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_customer_company uuid;
begin
  select * into v_vehicle from public.vehicles where id = new.vehicle_id;
  if not found or v_vehicle.company_id <> new.company_id then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  select company_id into v_customer_company from public.customers where id = new.customer_id;
  if v_customer_company is distinct from new.company_id then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = '23503';
  end if;

  if new.status in ('reservation', 'confirmed', 'in_progress')
     and (tg_op = 'INSERT'
          or new.vehicle_id is distinct from old.vehicle_id
          or new.pickup_at is distinct from old.pickup_at
          or new.return_at is distinct from old.return_at
          or new.status is distinct from old.status) then
    if v_vehicle.archived_at is not null
       or v_vehicle.status in ('maintenance', 'unavailable', 'sold') then
      raise exception 'VEHICLE_NOT_RENTABLE: vehicle status is %', v_vehicle.status
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger rentals_validate before insert or update on public.rentals
  for each row execute function app.validate_rental();

-- ---------------------------------------------------------------------
-- Seguros
-- ---------------------------------------------------------------------
create table public.insurance_policies (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  vehicle_id         uuid not null references public.vehicles(id) on delete restrict,
  insurer            text not null,
  policy_number      text not null,
  coverage_type      text,
  start_date         date not null,
  end_date           date not null,
  premium_amount     numeric(12,2) check (premium_amount >= 0),
  deductible_amount  numeric(12,2) check (deductible_amount >= 0),   -- franquia
  roadside_assistance boolean not null default false,
  assistance_phone   text,
  document_path      text,
  renewed_from_id    uuid references public.insurance_policies(id) on delete set null,
  notes              text,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null,
  updated_by         uuid references auth.users(id) on delete set null,
  constraint insurance_period_chk check (end_date >= start_date)
);
create index insurance_vehicle_idx on public.insurance_policies(vehicle_id, end_date desc);
create index insurance_expiry_idx on public.insurance_policies(company_id, end_date) where archived_at is null;

-- ---------------------------------------------------------------------
-- Documentos (metadados; o arquivo fica no Storage privado)
-- ---------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  category        public.document_category not null,
  title           text not null,
  storage_path    text not null,
  mime_type       text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes      bigint check (size_bytes > 0 and size_bytes <= 20971520),
  vehicle_id      uuid references public.vehicles(id) on delete restrict,
  customer_id     uuid references public.customers(id) on delete restrict,
  rental_id       uuid references public.rentals(id) on delete restrict,
  issued_at       date,
  expires_at      date,
  retention_until date,                     -- política de retenção (RGPD)
  is_personal_data boolean not null default false,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null
);
create index documents_company_idx on public.documents(company_id, category);
create index documents_expiry_idx on public.documents(company_id, expires_at) where archived_at is null and expires_at is not null;
create index documents_vehicle_idx on public.documents(vehicle_id);
create index documents_customer_idx on public.documents(customer_id);

-- ---------------------------------------------------------------------
-- Lançamentos financeiros
--   competence_date = regime de competência
--   paid_at         = fluxo de caixa
--   cauções NÃO entram aqui (tabela própria na fase 4)
--   compra de veículo = categoria 'vehicle_purchase' (investimento, não despesa operacional)
-- ---------------------------------------------------------------------
create table public.financial_transactions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  type             public.transaction_type not null,
  category         public.transaction_category not null,
  description      text not null check (length(trim(description)) > 0),
  amount           numeric(12,2) not null check (amount > 0),
  vat_rate         numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100),
  competence_date  date not null,
  due_date         date,
  paid_at          date,
  status           public.transaction_status not null default 'pending',
  payment_method   public.payment_method,
  vehicle_id       uuid references public.vehicles(id) on delete restrict,
  customer_id      uuid references public.customers(id) on delete restrict,
  rental_id        uuid references public.rentals(id) on delete restrict,
  receipt_path     text,
  is_operational   boolean generated always as (category <> 'vehicle_purchase') stored,
  notes            text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  constraint ft_category_type_chk check (
    (type = 'income' and category in ('rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income'))
    or (type = 'expense' and category not in ('rental', 'additional_fee', 'excess_mileage', 'extra_service', 'other_income'))
  ),
  constraint ft_paid_chk check (status <> 'paid' or paid_at is not null)
);
create index ft_company_competence_idx on public.financial_transactions(company_id, competence_date) where archived_at is null;
create index ft_company_paid_idx on public.financial_transactions(company_id, paid_at) where archived_at is null;
create index ft_vehicle_idx on public.financial_transactions(vehicle_id);
create index ft_rental_idx on public.financial_transactions(rental_id);

-- ---------------------------------------------------------------------
-- Triggers de autoria, auditoria e proteção de exclusão
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['vehicles', 'vehicle_valuations', 'customers', 'rentals',
                           'insurance_policies', 'documents', 'financial_transactions']
  loop
    execute format('create trigger %1$s_audit before insert or update on public.%1$I
                    for each row execute function app.set_audit_fields()', t);
  end loop;

  foreach t in array array['companies', 'profiles', 'vehicles', 'vehicle_valuations', 'customers',
                           'rentals', 'insurance_policies', 'documents', 'financial_transactions']
  loop
    execute format('create trigger %1$s_log after insert or update or delete on public.%1$I
                    for each row execute function app.log_activity()', t);
  end loop;

  foreach t in array array['rentals', 'financial_transactions']
  loop
    execute format('create trigger %1$s_no_hard_delete before delete on public.%1$I
                    for each row execute function app.prevent_hard_delete()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.companies              enable row level security;
alter table public.profiles               enable row level security;
alter table public.activity_logs          enable row level security;
alter table public.vehicles               enable row level security;
alter table public.vehicle_valuations     enable row level security;
alter table public.customers              enable row level security;
alter table public.rentals                enable row level security;
alter table public.insurance_policies     enable row level security;
alter table public.documents              enable row level security;
alter table public.financial_transactions enable row level security;

-- companies: equipe lê a própria empresa; só o proprietário altera
create policy companies_select on public.companies for select to authenticated
  using (id = app.current_company_id());
create policy companies_update on public.companies for update to authenticated
  using (id = app.current_company_id() and app.is_owner())
  with check (id = app.current_company_id() and app.is_owner());

-- profiles: equipe vê colegas da mesma empresa; cada um edita o próprio
-- perfil; o proprietário edita todos (o trigger guard impede escalonamento)
create policy profiles_select on public.profiles for select to authenticated
  using (company_id = app.current_company_id());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_owner on public.profiles for update to authenticated
  using (company_id = app.current_company_id() and app.is_owner())
  with check (company_id = app.current_company_id());

-- activity_logs: somente leitura (escrita apenas via triggers SECURITY DEFINER).
-- Proprietário vê tudo; administrador vê apenas as próprias ações.
create policy activity_logs_select on public.activity_logs for select to authenticated
  using (company_id = app.current_company_id() and (app.is_owner() or user_id = auth.uid()));

-- Tabelas operacionais: equipe da empresa lê/insere/atualiza; só o proprietário exclui
do $$
declare
  t text;
begin
  foreach t in array array['vehicles', 'vehicle_valuations', 'customers', 'rentals',
                           'insurance_policies', 'documents', 'financial_transactions']
  loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (company_id = app.current_company_id())
                    with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                    using (company_id = app.current_company_id() and app.is_owner())', t);
  end loop;
end $$;

-- Privilégios: anon não acessa nada; authenticated limitado pelas políticas
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
revoke insert, update, delete on public.activity_logs from authenticated;
revoke insert, delete on public.companies from authenticated;
revoke insert, delete on public.profiles from authenticated;

-- =====================================================================
-- RPCs DO DASHBOARD (SECURITY INVOKER → respeitam RLS)
-- p_from / p_to são datas locais (Europe/Madrid), intervalo fechado.
-- =====================================================================

-- Dias (fracionados por dia civil) de um aluguel que caem dentro de [p_from, p_to]
create or replace function app.rental_days_in_range(
  p_pickup timestamptz, p_return timestamptz, p_from date, p_to date)
returns integer
language sql immutable
as $$
  select greatest(0,
    (least((p_return at time zone 'Europe/Madrid')::date, p_to + 1)
     - greatest((p_pickup at time zone 'Europe/Madrid')::date, p_from)))::integer
$$;

create or replace function public.dashboard_kpis(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select status from public.vehicles where archived_at is null and status <> 'sold'
  ),
  ft as (
    select type, amount from public.financial_transactions
    where archived_at is null and status <> 'cancelled' and is_operational
      and competence_date between p_from and p_to
  ),
  totals as (
    select coalesce(sum(amount) filter (where type = 'income'), 0)::numeric(14,2) as revenue,
           coalesce(sum(amount) filter (where type = 'expense'), 0)::numeric(14,2) as expenses
    from ft
  )
  select jsonb_build_object(
    'vehicles_total',       (select count(*) from v),
    'vehicles_available',   (select count(*) from v where status = 'available'),
    'vehicles_rented',      (select count(*) from v where status = 'rented'),
    'vehicles_reserved',    (select count(*) from v where status = 'reserved'),
    'vehicles_maintenance', (select count(*) from v where status = 'maintenance'),
    'revenue',              (select revenue from totals),
    'expenses',             (select expenses from totals),
    'operating_profit',     (select revenue - expenses from totals),
    'active_contracts',     (select count(*) from public.rentals
                              where archived_at is null and status in ('confirmed', 'in_progress', 'late')),
    'upcoming_returns',     (select count(*) from public.rentals
                              where archived_at is null and status in ('confirmed', 'in_progress', 'late')
                                and return_at < now() + interval '7 days'),
    'insurance_expiring',   (select count(*) from public.insurance_policies ip
                              where ip.archived_at is null
                                and ip.end_date <= (now() at time zone 'Europe/Madrid')::date + 30
                                and not exists (select 1 from public.insurance_policies n
                                                where n.renewed_from_id = ip.id and n.archived_at is null)),
    'documents_expiring',   (select count(*) from public.documents
                              where archived_at is null and expires_at is not null
                                and expires_at <= (now() at time zone 'Europe/Madrid')::date + 30)
                            + (select count(*) from public.vehicles
                              where archived_at is null and status <> 'sold' and itv_due_date is not null
                                and itv_due_date <= (now() at time zone 'Europe/Madrid')::date + 30)
  );
$$;

-- Série mensal: receita, despesa, lucro, ocupação e patrimônio
create or replace function public.dashboard_monthly(p_from date, p_to date)
returns table (
  month date,
  revenue numeric,
  expenses numeric,
  profit numeric,
  occupancy_pct numeric,
  fleet_value numeric
)
language sql stable security invoker set search_path = ''
as $$
  with months as (
    select gs::date as m_start,
           least((gs + interval '1 month - 1 day')::date, p_to) as m_end,
           greatest(gs::date, p_from) as r_start
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs
  ),
  fin as (
    select date_trunc('month', competence_date)::date as m,
           sum(amount) filter (where type = 'income') as inc,
           sum(amount) filter (where type = 'expense') as exp
    from public.financial_transactions
    where archived_at is null and status <> 'cancelled' and is_operational
      and competence_date between p_from and p_to
    group by 1
  ),
  occ as (
    select mo.m_start,
           sum(app.rental_days_in_range(r.pickup_at, coalesce(r.actual_return_at, r.return_at), mo.r_start, mo.m_end)) as rented_days
    from months mo
    join public.rentals r on r.archived_at is null
      and r.status in ('confirmed', 'in_progress', 'late', 'completed')
    group by mo.m_start
  ),
  capacity as (
    select mo.m_start,
           sum(greatest(0, least(coalesce(v.fleet_exit_date, mo.m_end), mo.m_end)
                         - greatest(coalesce(v.fleet_entry_date, v.acquisition_date, v.created_at::date), mo.r_start) + 1)) as days
    from months mo
    join public.vehicles v on v.archived_at is null
    group by mo.m_start
  ),
  value as (
    select mo.m_start,
           sum(coalesce(
             (select vv.value from public.vehicle_valuations vv
               where vv.vehicle_id = v.id and vv.valuation_date <= mo.m_end
               order by vv.valuation_date desc limit 1),
             v.purchase_price, 0)) as total
    from months mo
    join public.vehicles v on v.archived_at is null
      and coalesce(v.fleet_entry_date, v.acquisition_date, v.created_at::date) <= mo.m_end
      and (v.fleet_exit_date is null or v.fleet_exit_date > mo.m_end)
    group by mo.m_start
  )
  select mo.m_start,
         coalesce(f.inc, 0)::numeric(14,2),
         coalesce(f.exp, 0)::numeric(14,2),
         (coalesce(f.inc, 0) - coalesce(f.exp, 0))::numeric(14,2),
         case when coalesce(c.days, 0) > 0
              then round(least(coalesce(o.rented_days, 0)::numeric / c.days * 100, 100), 1)
              else 0 end,
         coalesce(va.total, 0)::numeric(14,2)
  from months mo
  left join fin f on f.m = mo.m_start
  left join occ o on o.m_start = mo.m_start
  left join capacity c on c.m_start = mo.m_start
  left join value va on va.m_start = mo.m_start
  order by mo.m_start;
$$;

-- Receita, despesa, lucro e ocupação por veículo no período
create or replace function public.dashboard_vehicle_performance(p_from date, p_to date)
returns table (
  vehicle_id uuid,
  label text,
  plate text,
  revenue numeric,
  expenses numeric,
  profit numeric,
  rented_days integer,
  available_days integer,
  occupancy_pct numeric
)
language sql stable security invoker set search_path = ''
as $$
  with fin as (
    select vehicle_id,
           sum(amount) filter (where type = 'income') as inc,
           sum(amount) filter (where type = 'expense') as exp
    from public.financial_transactions
    where archived_at is null and status <> 'cancelled' and is_operational
      and vehicle_id is not null and competence_date between p_from and p_to
    group by vehicle_id
  ),
  occ as (
    select vehicle_id,
           sum(app.rental_days_in_range(pickup_at, coalesce(actual_return_at, return_at), p_from, p_to))::integer as days
    from public.rentals
    where archived_at is null and status in ('confirmed', 'in_progress', 'late', 'completed')
    group by vehicle_id
  ),
  base as (
    select v.id, v.brand || ' ' || v.model as label, v.plate,
           greatest(0, least(coalesce(v.fleet_exit_date, p_to), p_to)
                     - greatest(coalesce(v.fleet_entry_date, v.acquisition_date, v.created_at::date), p_from) + 1)::integer as avail
    from public.vehicles v
    where v.archived_at is null
  )
  select b.id, b.label, b.plate,
         coalesce(f.inc, 0)::numeric(14,2),
         coalesce(f.exp, 0)::numeric(14,2),
         (coalesce(f.inc, 0) - coalesce(f.exp, 0))::numeric(14,2),
         least(coalesce(o.days, 0), b.avail),
         b.avail,
         case when b.avail > 0 then round(least(coalesce(o.days, 0), b.avail)::numeric / b.avail * 100, 1) else 0 end
  from base b
  left join fin f on f.vehicle_id = b.id
  left join occ o on o.vehicle_id = b.id
  order by coalesce(f.inc, 0) - coalesce(f.exp, 0) desc, b.label;
$$;

-- Alertas operacionais (o texto é traduzido no frontend a partir de "kind")
create or replace function public.dashboard_alerts(p_limit integer default 20)
returns table (
  kind text,
  severity text,
  entity text,
  entity_id uuid,
  title text,
  due_date date
)
language sql stable security invoker set search_path = ''
as $$
  with today as (select (now() at time zone 'Europe/Madrid')::date as d),
  a as (
    select 'rental_overdue'::text as kind, 'critical'::text as severity, 'rentals'::text as entity, r.id,
           r.contract_number || ' · ' || v.plate as title,
           (r.return_at at time zone 'Europe/Madrid')::date as due
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('confirmed', 'in_progress', 'late') and r.return_at < now()
    union all
    select 'rental_return_soon', 'info', 'rentals', r.id,
           r.contract_number || ' · ' || v.plate,
           (r.return_at at time zone 'Europe/Madrid')::date
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('confirmed', 'in_progress')
      and r.return_at >= now() and r.return_at < now() + interval '3 days'
    union all
    select 'rental_pickup_soon', 'info', 'rentals', r.id,
           r.contract_number || ' · ' || v.plate,
           (r.pickup_at at time zone 'Europe/Madrid')::date
    from public.rentals r join public.vehicles v on v.id = r.vehicle_id
    where r.archived_at is null and r.status in ('reservation', 'confirmed')
      and r.pickup_at >= now() and r.pickup_at < now() + interval '3 days'
    union all
    select case when ip.end_date < t.d then 'insurance_expired' else 'insurance_expiring' end,
           case when ip.end_date < t.d then 'critical'
                when ip.end_date <= t.d + 7 then 'high'
                when ip.end_date <= t.d + 15 then 'medium' else 'low' end,
           'insurance_policies', ip.id,
           ip.insurer || ' · ' || v.plate, ip.end_date
    from public.insurance_policies ip
    join public.vehicles v on v.id = ip.vehicle_id
    cross join today t
    where ip.archived_at is null and v.archived_at is null and v.status <> 'sold'
      and ip.end_date <= t.d + 30
      and not exists (select 1 from public.insurance_policies n
                      where n.renewed_from_id = ip.id and n.archived_at is null)
    union all
    select case when v.itv_due_date < t.d then 'itv_expired' else 'itv_expiring' end,
           case when v.itv_due_date < t.d then 'critical'
                when v.itv_due_date <= t.d + 7 then 'high'
                when v.itv_due_date <= t.d + 15 then 'medium' else 'low' end,
           'vehicles', v.id, v.brand || ' ' || v.model || ' · ' || v.plate, v.itv_due_date
    from public.vehicles v cross join today t
    where v.archived_at is null and v.status <> 'sold'
      and v.itv_due_date is not null and v.itv_due_date <= t.d + 30
    union all
    select case when d.expires_at < t.d then 'document_expired' else 'document_expiring' end,
           case when d.expires_at < t.d then 'critical'
                when d.expires_at <= t.d + 7 then 'high' else 'medium' end,
           'documents', d.id, d.title, d.expires_at
    from public.documents d cross join today t
    where d.archived_at is null and d.expires_at is not null and d.expires_at <= t.d + 30
    union all
    select 'payment_overdue', 'high', 'financial_transactions', f.id, f.description, f.due_date
    from public.financial_transactions f cross join today t
    where f.archived_at is null and f.status = 'pending' and f.due_date is not null and f.due_date < t.d
  )
  select kind, severity, entity, id, title, due
  from a
  order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
           due nulls last
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.dashboard_kpis(date, date) from public, anon;
revoke all on function public.dashboard_monthly(date, date) from public, anon;
revoke all on function public.dashboard_vehicle_performance(date, date) from public, anon;
revoke all on function public.dashboard_alerts(integer) from public, anon;
grant execute on function public.dashboard_kpis(date, date) to authenticated;
grant execute on function public.dashboard_monthly(date, date) to authenticated;
grant execute on function public.dashboard_vehicle_performance(date, date) to authenticated;
grant execute on function public.dashboard_alerts(integer) to authenticated;

-- ---------------------------------------------------------------------
-- STORAGE: bucket privado para documentos (links temporários via signed URL)
-- Caminho obrigatório: <company_id>/<entidade>/<arquivo>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy documents_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = app.current_company_id()::text);
create policy documents_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = app.current_company_id()::text);
create policy documents_bucket_update on storage.objects for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = app.current_company_id()::text);
create policy documents_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = app.current_company_id()::text
         and app.is_owner());

-- >>>>> 20261104000001_users_settings.sql
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

-- >>>>> 20261105000001_vehicles_customers.sql
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

-- >>>>> 20261106000001_rentals.sql
-- =====================================================================
-- JB RENT PRO — Migration 0004: reservas, contratos, pagamentos e cauções
-- ---------------------------------------------------------------------
--   * cálculo do contrato NO BANCO (dias, valor base, extras, km excedente,
--     total) — a interface só mostra uma prévia com a mesma fórmula
--   * fluxo de status com regras (entrega exige km/combustível etc.)
--   * status do veículo sincronizado na entrega/devolução
--   * pagamentos (com estorno e anulação, nunca exclusão)
--   * cauções em tabela própria — NUNCA entram como receita
--   * lançamentos financeiros do contrato gerados automaticamente
--     (competência = data de devolução; pago quando o saldo zera)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Novos campos
-- ---------------------------------------------------------------------
alter table public.companies
  add column rental_grace_minutes smallint not null default 0 check (rental_grace_minutes between 0 and 720);

alter table public.rentals
  add column rental_days           integer not null default 1 check (rental_days >= 1),
  add column base_amount           numeric(12,2) not null default 0 check (base_amount >= 0),
  add column extras_amount         numeric(12,2) not null default 0 check (extras_amount >= 0),
  add column allowed_km            integer check (allowed_km >= 0),
  add column excess_km             integer not null default 0 check (excess_km >= 0),
  add column excess_mileage_amount numeric(12,2) not null default 0 check (excess_mileage_amount >= 0),
  add column picked_up_at          timestamptz,
  add column pickup_location       text,
  add column return_location       text,
  add column return_notes          text;

alter table public.financial_transactions
  add column rental_line text check (rental_line in ('rental', 'extras', 'excess_mileage'));
create unique index ft_rental_line_uidx on public.financial_transactions(rental_id, rental_line)
  where rental_line is not null;

-- ---------------------------------------------------------------------
-- Funções de cálculo (imutáveis → testáveis isoladamente)
-- ---------------------------------------------------------------------
-- Dias cobrados: blocos de 24 h a partir da retirada, com tolerância em minutos.
create or replace function app.rental_charge_days(p_pickup timestamptz, p_return timestamptz, p_grace_minutes integer default 0)
returns integer
language sql immutable
as $$
  select greatest(1, ceil(greatest(0, extract(epoch from (p_return - p_pickup)) - coalesce(p_grace_minutes, 0) * 60) / 86400.0)::integer)
$$;

-- Valor base conforme a modalidade: diária × dias; semanal e mensal proporcionais
-- ao dia (semana = 7 dias, mês = 30 dias); personalizado = valor fechado.
create or replace function app.rental_base_amount(p_mode public.rental_pricing_mode, p_unit numeric, p_days integer)
returns numeric
language sql immutable
as $$
  select round(case p_mode
    when 'daily'   then p_unit * p_days
    when 'weekly'  then p_unit * p_days / 7.0
    when 'monthly' then p_unit * p_days / 30.0
    else p_unit
  end, 2)
$$;

-- Quilometragem incluída no contrato (null = ilimitada)
create or replace function app.rental_allowed_km(p_policy public.mileage_policy, p_limit integer, p_days integer)
returns integer
language sql immutable
as $$
  select case p_policy
    when 'unlimited' then null
    when 'daily'   then p_limit * p_days
    when 'weekly'  then p_limit * ceil(p_days / 7.0)::integer
    when 'monthly' then p_limit * ceil(p_days / 30.0)::integer
    else p_limit
  end
$$;

-- ---------------------------------------------------------------------
-- Extras do contrato (catálogo de taxas ou itens livres)
-- ---------------------------------------------------------------------
create table public.rental_extras (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  rental_id    uuid not null references public.rentals(id) on delete cascade,
  fee_id       uuid references public.fee_catalog(id) on delete set null,
  name         text not null check (length(trim(name)) between 1 and 120),
  amount       numeric(10,2) not null check (amount >= 0),
  charge_type  public.fee_charge_type not null default 'per_rental',
  quantity     integer not null default 1 check (quantity between 1 and 99),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null
);
create index rental_extras_rental_idx on public.rental_extras(rental_id);

-- ---------------------------------------------------------------------
-- Cálculo e regras do contrato (BEFORE INSERT/UPDATE)
-- ---------------------------------------------------------------------
create or replace function app.compute_rental()
returns trigger
language plpgsql
as $$
declare
  v_grace integer;
  v_driven integer;
  v_locked boolean;
begin
  -- fluxo de status
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not (
      (old.status = 'reservation' and new.status in ('confirmed', 'cancelled', 'in_progress')) or
      (old.status = 'confirmed'   and new.status in ('in_progress', 'cancelled', 'reservation')) or
      (old.status = 'in_progress' and new.status in ('completed', 'late')) or
      (old.status = 'late'        and new.status in ('completed', 'in_progress'))
    ) then
      raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' and new.status not in ('reservation', 'confirmed') then
    raise exception 'INVALID_STATUS_TRANSITION: new contract must start as reservation or confirmed' using errcode = 'P0001';
  end if;

  -- contrato finalizado/cancelado: valores e período congelados
  if tg_op = 'UPDATE' and old.status in ('completed', 'cancelled') then
    v_locked := (new.vehicle_id, new.customer_id, new.pickup_at, new.return_at, new.pricing_mode, new.unit_price,
                 new.discount_amount, new.extra_fees_amount, new.mileage_policy, new.mileage_limit_km,
                 new.excess_km_price, new.start_mileage, new.end_mileage, new.deposit_amount)
                is distinct from
                (old.vehicle_id, old.customer_id, old.pickup_at, old.return_at, old.pricing_mode, old.unit_price,
                 old.discount_amount, old.extra_fees_amount, old.mileage_policy, old.mileage_limit_km,
                 old.excess_km_price, old.start_mileage, old.end_mileage, old.deposit_amount);
    if v_locked then
      raise exception 'RENTAL_LOCKED: completed or cancelled contracts cannot change' using errcode = 'P0001';
    end if;
  end if;
  -- em andamento: veículo, cliente e retirada não mudam
  if tg_op = 'UPDATE' and old.status in ('in_progress', 'late')
     and (new.vehicle_id, new.customer_id, new.pickup_at) is distinct from (old.vehicle_id, old.customer_id, old.pickup_at) then
    raise exception 'RENTAL_LOCKED: vehicle, customer and pickup cannot change after delivery' using errcode = 'P0001';
  end if;

  if new.status in ('in_progress', 'late', 'completed') and (new.start_mileage is null or new.start_fuel_level is null) then
    raise exception 'PICKUP_DATA_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status = 'completed' and (new.end_mileage is null or new.end_fuel_level is null or new.actual_return_at is null) then
    raise exception 'RETURN_DATA_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status = 'cancelled' and coalesce(trim(new.cancelled_reason), '') = '' then
    raise exception 'CANCEL_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status = 'in_progress' and new.picked_up_at is null then
    new.picked_up_at := now();
  end if;

  -- cálculo
  select coalesce(c.rental_grace_minutes, 0) into v_grace from public.companies c where c.id = new.company_id;
  new.rental_days := app.rental_charge_days(new.pickup_at, new.return_at, v_grace);
  new.base_amount := app.rental_base_amount(new.pricing_mode, new.unit_price, new.rental_days);
  new.extras_amount := coalesce((
    select round(sum(e.amount * e.quantity * case when e.charge_type = 'per_day' then new.rental_days else 1 end), 2)
    from public.rental_extras e where e.rental_id = new.id), 0);
  new.allowed_km := app.rental_allowed_km(new.mileage_policy, new.mileage_limit_km, new.rental_days);

  if new.end_mileage is not null and new.start_mileage is not null and new.allowed_km is not null then
    v_driven := new.end_mileage - new.start_mileage;
    new.excess_km := greatest(0, v_driven - new.allowed_km);
  else
    new.excess_km := 0;
  end if;
  new.excess_mileage_amount := round(new.excess_km * coalesce(new.excess_km_price, 0), 2);

  if new.discount_amount > new.base_amount + new.extra_fees_amount then
    raise exception 'DISCOUNT_TOO_HIGH' using errcode = 'P0001';
  end if;
  new.total_amount := new.base_amount + new.extra_fees_amount - new.discount_amount
                      + new.extras_amount + new.excess_mileage_amount;
  return new;
end;
$$;

create trigger rentals_compute before insert or update on public.rentals
  for each row execute function app.compute_rental();

-- Extras alteram o total: força o recálculo do contrato
create or replace function app.touch_rental_from_extra()
returns trigger
language plpgsql
as $$
begin
  update public.rentals set updated_at = now() where id = coalesce(new.rental_id, old.rental_id);
  return null;
end;
$$;

-- Extras de contratos fechados não podem mudar
create or replace function app.guard_rental_extra()
returns trigger
language plpgsql
as $$
declare
  v_status public.rental_status;
begin
  select status into v_status from public.rentals where id = coalesce(new.rental_id, old.rental_id);
  if v_status in ('completed', 'cancelled') then
    raise exception 'RENTAL_LOCKED' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger rental_extras_guard before insert or update or delete on public.rental_extras
  for each row execute function app.guard_rental_extra();
create trigger rental_extras_touch after insert or update or delete on public.rental_extras
  for each row execute function app.touch_rental_from_extra();
create trigger rental_extras_audit before insert or update on public.rental_extras
  for each row execute function app.set_audit_fields();
create trigger rental_extras_log after insert or update or delete on public.rental_extras
  for each row execute function app.log_activity();

-- ---------------------------------------------------------------------
-- Pagamentos do contrato (fluxo de caixa)
-- ---------------------------------------------------------------------
create type public.payment_kind as enum ('payment', 'refund');

create table public.rental_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  rental_id     uuid not null references public.rentals(id) on delete restrict,
  kind          public.payment_kind not null default 'payment',
  amount        numeric(12,2) not null check (amount > 0),
  paid_at       date not null,
  method        public.payment_method not null,
  reference     text check (reference is null or length(reference) <= 120),
  notes         text,
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  constraint rental_payments_void_chk check (voided_at is null or coalesce(trim(void_reason), '') <> '')
);
create index rental_payments_rental_idx on public.rental_payments(rental_id) where voided_at is null;
create index rental_payments_paid_idx on public.rental_payments(company_id, paid_at) where voided_at is null;

-- Só a anulação (com motivo) é permitida depois de registrado
create or replace function app.guard_rental_payment()
returns trigger
language plpgsql
as $$
begin
  if (new.rental_id, new.kind, new.amount, new.paid_at, new.method) is distinct from
     (old.rental_id, old.kind, old.amount, old.paid_at, old.method) then
    raise exception 'PAYMENT_IMMUTABLE: void it and register a new one' using errcode = 'P0001';
  end if;
  if old.voided_at is not null and new.voided_at is null then
    raise exception 'PAYMENT_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger rental_payments_guard before update on public.rental_payments
  for each row execute function app.guard_rental_payment();

-- ---------------------------------------------------------------------
-- Cauções (nunca contabilizadas como receita)
-- ---------------------------------------------------------------------
create table public.deposits (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default app.current_company_id() references public.companies(id) on delete restrict,
  rental_id        uuid not null unique references public.rentals(id) on delete restrict,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  vehicle_id       uuid not null references public.vehicles(id) on delete restrict,
  amount_received  numeric(12,2) not null default 0 check (amount_received >= 0),
  received_at      date,
  received_method  public.payment_method,
  amount_returned  numeric(12,2) not null default 0 check (amount_returned >= 0),
  returned_at      date,
  returned_method  public.payment_method,
  amount_retained  numeric(12,2) not null default 0 check (amount_retained >= 0),
  retention_reason text,
  notes            text,
  status           text generated always as (
                     case when amount_received = 0 then 'not_received'
                          when amount_returned + amount_retained >= amount_received then 'settled'
                          else 'held' end) stored,
  balance          numeric(12,2) generated always as (amount_received - amount_returned - amount_retained) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null,
  updated_by       uuid references auth.users(id) on delete set null,
  constraint deposits_amounts_chk check (amount_returned + amount_retained <= amount_received),
  constraint deposits_received_chk check (amount_received = 0 or received_at is not null),
  constraint deposits_returned_chk check (amount_returned = 0 or returned_at is not null),
  constraint deposits_retention_chk check (amount_retained = 0 or coalesce(trim(retention_reason), '') <> '')
);
create index deposits_status_idx on public.deposits(company_id, status);

-- ---------------------------------------------------------------------
-- Integração: veículo e financeiro (AFTER, SECURITY DEFINER)
-- ---------------------------------------------------------------------
create or replace function app.sync_rental_finance(p_rental_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_paid numeric;
  v_last date;
  v_status public.transaction_status;
  v_line text;
  v_amount numeric;
  v_category public.transaction_category;
begin
  select rt.*, v.plate into r
  from public.rentals rt join public.vehicles v on v.id = rt.vehicle_id
  where rt.id = p_rental_id;
  if not found then return; end if;

  select coalesce(sum(case when kind = 'payment' then amount else -amount end), 0), max(paid_at)
    into v_paid, v_last
  from public.rental_payments where rental_id = p_rental_id and voided_at is null;

  foreach v_line in array array['rental', 'extras', 'excess_mileage'] loop
    v_amount := case v_line
      when 'rental' then r.base_amount + r.extra_fees_amount - r.discount_amount
      when 'extras' then r.extras_amount
      else r.excess_mileage_amount end;
    v_category := case v_line when 'rental' then 'rental' when 'extras' then 'additional_fee' else 'excess_mileage' end;

    if r.status = 'reservation' or r.archived_at is not null or v_amount <= 0 then
      -- ainda não é receita (reserva) ou linha zerada: anula se existir
      update public.financial_transactions set status = 'cancelled', paid_at = null
       where rental_id = p_rental_id and rental_line = v_line and status <> 'cancelled';
      continue;
    end if;

    v_status := case when r.status = 'cancelled' then 'cancelled'
                     when v_paid >= r.total_amount then 'paid'
                     else 'pending' end;

    insert into public.financial_transactions as ft
      (company_id, type, category, description, amount, competence_date, due_date, paid_at, status,
       vehicle_id, customer_id, rental_id, rental_line, created_by, updated_by)
    values
      (r.company_id, 'income', v_category, r.contract_number || ' · ' || r.plate, v_amount,
       (r.return_at at time zone 'Europe/Madrid')::date, (r.pickup_at at time zone 'Europe/Madrid')::date,
       case when v_status = 'paid' then coalesce(v_last, (now() at time zone 'Europe/Madrid')::date) end,
       v_status, r.vehicle_id, r.customer_id, r.id, v_line, auth.uid(), auth.uid())
    on conflict (rental_id, rental_line) where rental_line is not null do update
      set amount = excluded.amount, competence_date = excluded.competence_date, due_date = excluded.due_date,
          paid_at = excluded.paid_at, status = excluded.status, vehicle_id = excluded.vehicle_id,
          customer_id = excluded.customer_id, description = excluded.description
      where (ft.amount, ft.competence_date, ft.due_date, ft.paid_at, ft.status, ft.vehicle_id, ft.customer_id, ft.description)
            is distinct from
            (excluded.amount, excluded.competence_date, excluded.due_date, excluded.paid_at, excluded.status,
             excluded.vehicle_id, excluded.customer_id, excluded.description);
  end loop;
end;
$$;

create or replace function app.after_rental_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- entrega: veículo alugado e km atualizada
  if new.status in ('in_progress', 'late') and (tg_op = 'INSERT' or old.status not in ('in_progress', 'late')) then
    update public.vehicles
       set status = 'rented', current_mileage = greatest(current_mileage, coalesce(new.start_mileage, 0))
     where id = new.vehicle_id;
  end if;
  -- devolução: libera o veículo (se não houver outro contrato em andamento) e atualiza a km
  if tg_op = 'UPDATE' and old.status in ('in_progress', 'late') and new.status = 'completed' then
    update public.vehicles v
       set current_mileage = greatest(v.current_mileage, coalesce(new.end_mileage, 0)),
           status = case when v.status = 'rented' and not exists (
                            select 1 from public.rentals o where o.vehicle_id = v.id and o.id <> new.id
                              and o.status in ('in_progress', 'late') and o.archived_at is null)
                         then 'available'::public.vehicle_status else v.status end
     where v.id = new.vehicle_id;
  end if;

  perform app.sync_rental_finance(new.id);

  -- caução: cria o registro com o valor combinado (recebimento é lançado à parte)
  if new.deposit_amount > 0 and not exists (select 1 from public.deposits d where d.rental_id = new.id) then
    insert into public.deposits (company_id, rental_id, customer_id, vehicle_id, created_by, updated_by)
    values (new.company_id, new.id, new.customer_id, new.vehicle_id, auth.uid(), auth.uid());
  end if;
  return null;
end;
$$;

create trigger rentals_after_change after insert or update on public.rentals
  for each row execute function app.after_rental_change();

create or replace function app.after_payment_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.sync_rental_finance(coalesce(new.rental_id, old.rental_id));
  return null;
end;
$$;
create trigger rental_payments_sync after insert or update on public.rental_payments
  for each row execute function app.after_payment_change();

-- ---------------------------------------------------------------------
-- Auditoria, RLS e privilégios
-- ---------------------------------------------------------------------
create trigger rental_payments_audit before insert or update on public.rental_payments
  for each row execute function app.set_audit_fields();
create trigger deposits_audit before insert or update on public.deposits
  for each row execute function app.set_audit_fields();
create trigger rental_payments_log after insert or update or delete on public.rental_payments
  for each row execute function app.log_activity();
create trigger deposits_log after insert or update or delete on public.deposits
  for each row execute function app.log_activity();
create trigger rental_payments_no_hard_delete before delete on public.rental_payments
  for each row execute function app.prevent_hard_delete();
create trigger deposits_no_hard_delete before delete on public.deposits
  for each row execute function app.prevent_hard_delete();

alter table public.rental_extras enable row level security;
alter table public.rental_payments enable row level security;
alter table public.deposits enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['rental_extras', 'rental_payments', 'deposits'] loop
    execute format('create policy %1$s_select on public.%1$I for select to authenticated
                    using (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                    with check (company_id = app.current_company_id())', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                    using (company_id = app.current_company_id())
                    with check (company_id = app.current_company_id())', t);
  end loop;
end $$;
-- extras: a equipe remove itens de contratos abertos (a guarda bloqueia os fechados)
create policy rental_extras_delete on public.rental_extras for delete to authenticated
  using (company_id = app.current_company_id());
-- pagamentos e cauções: sem política de DELETE para a equipe (exclusão só com autorização especial)
create policy rental_payments_delete on public.rental_payments for delete to authenticated
  using (company_id = app.current_company_id() and app.is_owner());
create policy deposits_delete on public.deposits for delete to authenticated
  using (company_id = app.current_company_id() and app.is_owner());

grant select, insert, update, delete on public.rental_extras, public.rental_payments, public.deposits to authenticated;
revoke all on public.rental_extras, public.rental_payments, public.deposits from anon;

-- ---------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------
-- Resumo financeiro do contrato: total, pago, saldo e caução
create or replace function public.rental_balance(p_rental_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'total',    r.total_amount,
    'paid',     coalesce((select sum(case when kind = 'payment' then amount else -amount end)
                          from public.rental_payments where rental_id = r.id and voided_at is null), 0)::numeric(14,2),
    'balance',  (r.total_amount - coalesce((select sum(case when kind = 'payment' then amount else -amount end)
                          from public.rental_payments where rental_id = r.id and voided_at is null), 0))::numeric(14,2),
    'deposit_agreed',   r.deposit_amount,
    'deposit_received', coalesce(d.amount_received, 0),
    'deposit_returned', coalesce(d.amount_returned, 0),
    'deposit_retained', coalesce(d.amount_retained, 0),
    'deposit_balance',  coalesce(d.balance, 0),
    'deposit_status',   coalesce(d.status, 'not_received')
  )
  from public.rentals r
  left join public.deposits d on d.rental_id = r.id
  where r.id = p_rental_id;
$$;

-- Conflitos de agenda para a prévia do formulário (a garantia é a constraint EXCLUDE)
create or replace function public.vehicle_conflicts(p_vehicle_id uuid, p_from timestamptz, p_to timestamptz, p_exclude uuid default null)
returns table (id uuid, contract_number text, status public.rental_status, pickup_at timestamptz, return_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select r.id, r.contract_number, r.status, r.pickup_at, r.return_at
  from public.rentals r
  where r.vehicle_id = p_vehicle_id
    and r.archived_at is null
    and r.status in ('reservation', 'confirmed', 'in_progress', 'late')
    and (p_exclude is null or r.id <> p_exclude)
    and tstzrange(r.pickup_at, r.return_at, '[)') && tstzrange(p_from, p_to, '[)')
  order by r.pickup_at
  limit 10;
$$;

-- Prévia de cálculo com as mesmas fórmulas do contrato (usada para conferência)
create or replace function public.rental_quote(
  p_pickup timestamptz, p_return timestamptz, p_mode public.rental_pricing_mode, p_unit numeric,
  p_policy public.mileage_policy, p_limit integer)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with g as (select coalesce((select rental_grace_minutes from public.companies where id = app.current_company_id()), 0) as grace),
  d as (select app.rental_charge_days(p_pickup, p_return, (select grace from g)) as days)
  select jsonb_build_object(
    'days', d.days,
    'base', app.rental_base_amount(p_mode, p_unit, d.days),
    'allowed_km', app.rental_allowed_km(p_policy, p_limit, d.days),
    'grace_minutes', (select grace from g)
  ) from d;
$$;

revoke all on function public.rental_balance(uuid) from public, anon;
revoke all on function public.vehicle_conflicts(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.rental_quote(timestamptz, timestamptz, public.rental_pricing_mode, numeric, public.mileage_policy, integer) from public, anon;
grant execute on function public.rental_balance(uuid) to authenticated;
grant execute on function public.vehicle_conflicts(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.rental_quote(timestamptz, timestamptz, public.rental_pricing_mode, numeric, public.mileage_policy, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard: reservados = disponíveis com retirada nas próximas 48 h
-- (ou marcados manualmente); cauções em aberto; novos alertas
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kpis(p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with v as (
    select vv.id, vv.status,
           (vv.status = 'available' and exists (
              select 1 from public.rentals r where r.vehicle_id = vv.id and r.archived_at is null
                and r.status in ('reservation', 'confirmed')
                and r.pickup_at < now() + interval '48 hours' and r.return_at > now())) as soon
    from public.vehicles vv where vv.archived_at is null and vv.status <> 'sold'
  ),
  ft as (
    select type, amount from public.financial_transactions
    where archived_at is null and status <> 'cancelled' and is_operational
      and competence_date between p_from and p_to
  ),
  totals as (
    select coalesce(sum(amount) filter (where type = 'income'), 0)::numeric(14,2) as revenue,
           coalesce(sum(amount) filter (where type = 'expense'), 0)::numeric(14,2) as expenses
    from ft
  )
  select jsonb_build_object(
    'vehicles_total',       (select count(*) from v),
    'vehicles_available',   (select count(*) from v where status = 'available' and not soon),
    'vehicles_rented',      (select count(*) from v where status = 'rented'),
    'vehicles_reserved',    (select count(*) from v where status = 'reserved' or soon),
    'vehicles_maintenance', (select count(*) from v where status = 'maintenance'),
    'revenue',              (select revenue from totals),
    'expenses',             (select expenses from totals),
    'operating_profit',     (select revenue - expenses from totals),
    'active_contracts',     (select count(*) from public.rentals
                              where archived_at is null and status in ('confirmed', 'in_progress', 'late')),
    'upcoming_returns',     (select count(*) from public.rentals
                              where archived_at is null and status in ('in_progress', 'late')
                                and return_at < now() + interval '7 days'),
    'insurance_expiring',   (select count(*) from public.insurance_policies ip
                              where ip.archived_at is null
                                and ip.end_date <= (now() at time zone 'Europe/Madrid')::date + 30
                                and not exists (select 1 from public.insurance_policies n
                                                where n.renewed_from_id = ip.id and n.archived_at is null)),
    'documents_expiring',   (select count(*) from public.documents
                              where archived_at is null and expires_at is not null
                                and expires_at <= (now() at time zone 'Europe/Madrid')::date + 30)
                            + (select count(*) from public.vehicles
                              where archived_at is null and status <> 'sold' and itv_due_date is not null
                                and itv_due_date <= (now() at time zone 'Europe/Madrid')::date + 30),
    'deposits_held',        (select count(*) from public.deposits where status = 'held'),
    'deposits_held_amount', coalesce((select sum(balance) from public.deposits where status = 'held'), 0)::numeric(14,2)
  );
$$;

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
  )
  select kind, severity, entity, id, title, due
  from a
  order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
           due nulls last
  limit greatest(1, least(p_limit, 100));
$$;

-- ---------------------------------------------------------------------
-- Salvar contrato + extras numa única transação (tudo ou nada)
-- ---------------------------------------------------------------------
create or replace function public.save_rental(p_id uuid, p_data jsonb, p_extras jsonb default '[]'::jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_status public.rental_status;
begin
  if p_id is null then
    insert into public.rentals (
      customer_id, vehicle_id, status, pickup_at, return_at, pricing_mode, unit_price, discount_amount,
      extra_fees_amount, deposit_amount, payment_method, mileage_policy, mileage_limit_km, excess_km_price,
      contract_locale, pickup_location, return_location, notes)
    values (
      (p_data ->> 'customer_id')::uuid, (p_data ->> 'vehicle_id')::uuid,
      coalesce(p_data ->> 'status', 'confirmed')::public.rental_status,
      (p_data ->> 'pickup_at')::timestamptz, (p_data ->> 'return_at')::timestamptz,
      (p_data ->> 'pricing_mode')::public.rental_pricing_mode, (p_data ->> 'unit_price')::numeric,
      coalesce((p_data ->> 'discount_amount')::numeric, 0), coalesce((p_data ->> 'extra_fees_amount')::numeric, 0),
      coalesce((p_data ->> 'deposit_amount')::numeric, 0), (p_data ->> 'payment_method')::public.payment_method,
      (p_data ->> 'mileage_policy')::public.mileage_policy, (p_data ->> 'mileage_limit_km')::integer,
      (p_data ->> 'excess_km_price')::numeric, coalesce(p_data ->> 'contract_locale', 'es-ES'),
      p_data ->> 'pickup_location', p_data ->> 'return_location', p_data ->> 'notes')
    returning id into v_id;
  else
    select status into v_status from public.rentals where id = p_id;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_status in ('completed', 'cancelled') then
      raise exception 'RENTAL_LOCKED' using errcode = 'P0001';
    end if;
    update public.rentals set
      customer_id = (p_data ->> 'customer_id')::uuid, vehicle_id = (p_data ->> 'vehicle_id')::uuid,
      pickup_at = (p_data ->> 'pickup_at')::timestamptz, return_at = (p_data ->> 'return_at')::timestamptz,
      pricing_mode = (p_data ->> 'pricing_mode')::public.rental_pricing_mode, unit_price = (p_data ->> 'unit_price')::numeric,
      discount_amount = coalesce((p_data ->> 'discount_amount')::numeric, 0),
      extra_fees_amount = coalesce((p_data ->> 'extra_fees_amount')::numeric, 0),
      deposit_amount = coalesce((p_data ->> 'deposit_amount')::numeric, 0),
      payment_method = (p_data ->> 'payment_method')::public.payment_method,
      mileage_policy = (p_data ->> 'mileage_policy')::public.mileage_policy,
      mileage_limit_km = (p_data ->> 'mileage_limit_km')::integer, excess_km_price = (p_data ->> 'excess_km_price')::numeric,
      contract_locale = coalesce(p_data ->> 'contract_locale', contract_locale),
      pickup_location = p_data ->> 'pickup_location', return_location = p_data ->> 'return_location', notes = p_data ->> 'notes'
    where id = p_id;
    delete from public.rental_extras where rental_id = p_id;
  end if;

  insert into public.rental_extras (rental_id, fee_id, name, amount, charge_type, quantity)
  select v_id, nullif(e ->> 'fee_id', '')::uuid, e ->> 'name', (e ->> 'amount')::numeric,
         coalesce(e ->> 'charge_type', 'per_rental')::public.fee_charge_type, coalesce((e ->> 'quantity')::integer, 1)
  from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) e;

  return v_id;
end;
$$;
revoke all on function public.save_rental(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_rental(uuid, jsonb, jsonb) to authenticated;

-- >>>>> 20261107000001_inspections_damages.sql
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

-- >>>>> 20261108000001_insurance_documents.sql
-- =====================================================================
-- JB RENT PRO — Migration 0006: seguros e central de documentos
-- ---------------------------------------------------------------------
--   * apólices: coerência com o veículo, renovação encadeada (1 por apólice),
--     prêmio lançado automaticamente como despesa "Seguros"
--   * documentos: vínculo com apólice, pastas por entidade, retenção
--     calculada pela política da empresa, contrato assinado
--   * alertas de vencimento também para documentos de clientes
-- =====================================================================

-- ---------------------------------------------------------------------
-- Seguros
-- ---------------------------------------------------------------------
alter table public.insurance_policies
  add column paid_at date,
  add column payment_method public.payment_method;

create unique index insurance_renewal_uidx on public.insurance_policies(renewed_from_id)
  where renewed_from_id is not null and archived_at is null;
create unique index insurance_number_uidx on public.insurance_policies(company_id, upper(policy_number), start_date)
  where archived_at is null;

create or replace function app.validate_insurance()
returns trigger
language plpgsql
as $$
declare
  v_company uuid;
  p record;
begin
  select company_id into v_company from public.vehicles where id = new.vehicle_id;
  if v_company is distinct from new.company_id then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  new.policy_number := upper(trim(new.policy_number));
  new.insurer := trim(new.insurer);
  if new.renewed_from_id is not null then
    select vehicle_id, end_date, company_id into p from public.insurance_policies where id = new.renewed_from_id;
    if not found or p.company_id <> new.company_id or p.vehicle_id <> new.vehicle_id then
      raise exception 'RENEWAL_MISMATCH: renewal must be for the same vehicle' using errcode = 'P0001';
    end if;
    if new.start_date < p.end_date - 31 then
      raise exception 'RENEWAL_MISMATCH: renewal must start near the end of the previous policy' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger insurance_validate before insert or update on public.insurance_policies
  for each row execute function app.validate_insurance();

-- Lançamento financeiro do prêmio (despesa "Seguros", competência no início da vigência)
alter table public.financial_transactions
  add column insurance_policy_id uuid references public.insurance_policies(id) on delete restrict;
create unique index ft_insurance_uidx on public.financial_transactions(insurance_policy_id)
  where insurance_policy_id is not null;

create or replace function app.sync_insurance_finance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_plate text;
begin
  select plate into v_plate from public.vehicles where id = new.vehicle_id;
  if new.archived_at is not null or coalesce(new.premium_amount, 0) <= 0 then
    update public.financial_transactions set status = 'cancelled', paid_at = null
     where insurance_policy_id = new.id and status <> 'cancelled';
    return null;
  end if;
  insert into public.financial_transactions as ft
    (company_id, type, category, description, amount, competence_date, due_date, paid_at, status,
     payment_method, vehicle_id, insurance_policy_id, created_by, updated_by)
  values
    (new.company_id, 'expense', 'insurance', new.insurer || ' · ' || new.policy_number || ' · ' || v_plate,
     new.premium_amount, new.start_date, new.start_date, new.paid_at,
     case when new.paid_at is not null then 'paid'::public.transaction_status else 'pending' end,
     new.payment_method, new.vehicle_id, new.id, auth.uid(), auth.uid())
  on conflict (insurance_policy_id) where insurance_policy_id is not null do update
    set amount = excluded.amount, competence_date = excluded.competence_date, due_date = excluded.due_date,
        paid_at = excluded.paid_at, status = excluded.status, payment_method = excluded.payment_method,
        vehicle_id = excluded.vehicle_id, description = excluded.description
    where (ft.amount, ft.competence_date, ft.paid_at, ft.status, ft.payment_method, ft.vehicle_id, ft.description)
          is distinct from (excluded.amount, excluded.competence_date, excluded.paid_at, excluded.status,
                            excluded.payment_method, excluded.vehicle_id, excluded.description);
  return null;
end;
$$;
create trigger insurance_finance after insert or update on public.insurance_policies
  for each row execute function app.sync_insurance_finance();

create trigger insurance_policies_no_hard_delete before delete on public.insurance_policies
  for each row execute function app.prevent_hard_delete();

-- ---------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------
alter table public.documents
  add column insurance_policy_id uuid references public.insurance_policies(id) on delete restrict,
  add column notes text check (notes is null or length(notes) <= 2000);
create index documents_insurance_idx on public.documents(insurance_policy_id);
create index documents_rental_idx on public.documents(rental_id);

-- Retenção padrão = emissão (ou envio) + anos configurados pela empresa
create or replace function app.default_document_retention()
returns trigger
language plpgsql
as $$
declare
  v_years smallint;
begin
  if new.retention_until is null then
    select document_retention_years into v_years from public.companies where id = new.company_id;
    if v_years is not null then
      new.retention_until := (coalesce(new.issued_at, (now() at time zone 'Europe/Madrid')::date) + make_interval(years => v_years))::date;
    end if;
  end if;
  -- vínculos coerentes com a empresa
  if new.vehicle_id is not null and not exists (select 1 from public.vehicles v where v.id = new.vehicle_id and v.company_id = new.company_id) then
    raise exception 'VEHICLE_NOT_FOUND' using errcode = '23503';
  end if;
  if new.rental_id is not null and not exists (select 1 from public.rentals r where r.id = new.rental_id and r.company_id = new.company_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  if new.insurance_policy_id is not null and not exists (select 1 from public.insurance_policies i where i.id = new.insurance_policy_id and i.company_id = new.company_id) then
    raise exception 'NOT_FOUND' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger documents_defaults before insert or update on public.documents
  for each row execute function app.default_document_retention();

create or replace function app.default_customer_document_retention()
returns trigger
language plpgsql
as $$
declare
  v_years smallint;
begin
  if new.retention_until is null then
    select document_retention_years into v_years from public.companies where id = new.company_id;
    if v_years is not null then
      new.retention_until := ((now() at time zone 'Europe/Madrid')::date + make_interval(years => v_years))::date;
    end if;
  end if;
  return new;
end;
$$;
create trigger customer_documents_defaults before insert or update on public.customer_documents
  for each row execute function app.default_customer_document_retention();

-- Contrato assinado enviado → contrato marcado como assinado (assinatura manuscrita digitalizada)
create or replace function app.after_signed_contract()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.category = 'contract' and new.rental_id is not null and new.archived_at is null then
    update public.rentals set signature_status = 'signed', signature_provider_ref = 'upload:' || new.id::text
     where id = new.rental_id and signature_status <> 'signed';
  end if;
  return null;
end;
$$;
create trigger documents_signed_contract after insert on public.documents
  for each row execute function app.after_signed_contract();

-- ---------------------------------------------------------------------
-- Alertas complementares: documentos de clientes vencendo e veículos sem seguro vigente
-- ---------------------------------------------------------------------
create or replace function public.extra_alert_rows()
returns table (kind text, severity text, entity text, entity_id uuid, title text, due_date date)
language sql stable security invoker set search_path = ''
as $$
  with t as (select (now() at time zone 'Europe/Madrid')::date as d)
  select case when cd.expires_at < t.d then 'document_expired' else 'document_expiring' end,
         case when cd.expires_at < t.d then 'high' when cd.expires_at <= t.d + 7 then 'medium' else 'low' end,
         'customer_documents', cd.customer_id,
         cd.title || ' · ' || coalesce(case when c.customer_type = 'company' then c.company_name else c.full_name end, ''),
         cd.expires_at
  from public.customer_documents cd join public.customers c on c.id = cd.customer_id cross join t
  where cd.archived_at is null and c.archived_at is null and cd.expires_at is not null and cd.expires_at <= t.d + 30
  union all
  select 'vehicle_uninsured', 'critical', 'vehicles', v.id, v.brand || ' ' || v.model || ' · ' || v.plate, null::date
  from public.vehicles v cross join t
  where v.archived_at is null and v.status not in ('sold', 'unavailable')
    and not exists (select 1 from public.insurance_policies ip where ip.vehicle_id = v.id and ip.archived_at is null
                      and ip.start_date <= t.d and ip.end_date >= t.d)
$$;
revoke all on function public.extra_alert_rows() from public, anon;
grant execute on function public.extra_alert_rows() to authenticated;

-- Resumo de seguros por situação (para a central e o dashboard)
create or replace function public.insurance_overview()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with t as (select (now() at time zone 'Europe/Madrid')::date as d),
  p as (
    select ip.*, exists (select 1 from public.insurance_policies n where n.renewed_from_id = ip.id and n.archived_at is null) as renewed
    from public.insurance_policies ip where ip.archived_at is null
  )
  select jsonb_build_object(
    'active',   (select count(*) from p, t where p.start_date <= t.d and p.end_date >= t.d),
    'expiring', (select count(*) from p, t where not p.renewed and p.end_date >= t.d and p.end_date <= t.d + 30),
    'expired',  (select count(*) from p, t where not p.renewed and p.end_date < t.d),
    'uninsured_vehicles', (select count(*) from public.vehicles v, t where v.archived_at is null and v.status <> 'sold'
                             and not exists (select 1 from p where p.vehicle_id = v.id and p.start_date <= t.d and p.end_date >= t.d)),
    'premiums_year', coalesce((select sum(premium_amount) from p, t where date_trunc('year', p.start_date) = date_trunc('year', t.d)), 0)::numeric(14,2)
  );
$$;
revoke all on function public.insurance_overview() from public, anon;
grant execute on function public.insurance_overview() to authenticated;

-- ---------------------------------------------------------------------
-- Exclusão definitiva após o prazo de retenção (somente administrador principal)
-- Devolve o caminho do arquivo para remoção no Storage.
-- ---------------------------------------------------------------------
create or replace function public.purge_document(p_id uuid)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_path text;
begin
  if not app.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select storage_path into v_path from public.documents
   where id = p_id and retention_until is not null
     and retention_until < (now() at time zone 'Europe/Madrid')::date;
  if v_path is null then
    raise exception 'RETENTION_ACTIVE: document is still within its retention period' using errcode = 'P0001';
  end if;
  perform set_config('app.allow_hard_delete', 'on', true);
  delete from public.documents where id = p_id;
  perform set_config('app.allow_hard_delete', 'off', true);
  return v_path;
end;
$$;
revoke all on function public.purge_document(uuid) from public, anon;
grant execute on function public.purge_document(uuid) to authenticated;

-- >>>>> 20261109000001_finance_categories.sql
-- =====================================================================
-- JB RENT PRO — Migration 0007a: novas categorias (arquivo separado porque
-- valores novos de enum só podem ser usados depois do commit)
-- =====================================================================
alter type public.transaction_category add value if not exists 'repairs';
alter type public.transaction_category add value if not exists 'fines';
alter type public.transaction_category add value if not exists 'fine_recharge';
alter type public.transaction_category add value if not exists 'damage_recovery';

alter type public.document_category add value if not exists 'maintenance_invoice';
alter type public.document_category add value if not exists 'fine_notice';
alter type public.document_category add value if not exists 'accident_report';
