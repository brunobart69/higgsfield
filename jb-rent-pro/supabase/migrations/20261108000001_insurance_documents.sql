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
