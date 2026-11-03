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
