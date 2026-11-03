import "server-only";
import { createClient } from "@/lib/supabase/server";

export type CompanySettings = {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_path: string | null;
  default_locale: "pt-BR" | "es-ES";
  currency: string;
  timezone: string;
  vat_rate: number | null;
  prices_include_vat: boolean;
  iban: string | null;
  fiscal_notes: string | null;
  document_retention_years: number | null;
  default_daily_price: number | null;
  default_weekly_price: number | null;
  default_monthly_price: number | null;
  default_deposit_amount: number | null;
  default_mileage_policy: "unlimited" | "daily" | "weekly" | "monthly" | "custom";
  default_mileage_limit_km: number | null;
  default_excess_km_price: number | null;
  rental_grace_minutes: number;
  rental_conditions_pt: string | null;
  rental_conditions_es: string | null;
  contract_footer: string | null;
};

export type Fee = {
  id: string;
  name_pt: string;
  name_es: string;
  amount: number;
  charge_type: "per_rental" | "per_day";
  vat_rate: number | null;
  is_active: boolean;
};

const COMPANY_COLUMNS =
  "id, name, legal_name, tax_id, address, city, postal_code, province, phone, email, website, logo_path, default_locale, currency, timezone, vat_rate, prices_include_vat, iban, fiscal_notes, document_retention_years, default_daily_price, default_weekly_price, default_monthly_price, default_deposit_amount, default_mileage_policy, default_mileage_limit_km, default_excess_km_price, rental_grace_minutes, rental_conditions_pt, rental_conditions_es, contract_footer";

export async function getCompanySettings(opts?: { client: Awaited<ReturnType<typeof createClient>>; companyId: string }): Promise<CompanySettings | null> {
  const supabase = opts?.client ?? (await createClient());
  let q = supabase.from("companies").select(COMPANY_COLUMNS);
  if (opts) q = q.eq("id", opts.companyId);
  const { data, error } = await q.maybeSingle();
  if (error) {
    console.error("[settings] load failed", error.code, error.message);
    return null;
  }
  return data as CompanySettings | null;
}

export async function listFees(): Promise<Fee[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_catalog")
    .select("id, name_pt, name_es, amount, charge_type, vat_rate, is_active")
    .order("sort_order")
    .order("name_pt");
  if (error) {
    console.error("[settings] fees failed", error.code, error.message);
    return [];
  }
  return (data ?? []) as Fee[];
}

/** URL temporária (10 min) para exibir o logotipo do bucket privado. */
export async function getLogoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("documents").createSignedUrl(path, 600);
  if (error) return null;
  return data.signedUrl;
}
