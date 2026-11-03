import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import { CUSTOMERS_PAGE_SIZE, type CustomerType } from "./constants";

export type CustomerListItem = {
  id: string;
  customer_type: CustomerType;
  full_name: string | null;
  company_name: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  driving_licence_expiry: string | null;
  archived_at: string | null;
  anonymized_at: string | null;
};

export type CustomerDetail = CustomerListItem & {
  birth_date: string | null;
  nationality: string | null;
  driving_licence_number: string | null;
  legal_name: string | null;
  representative_name: string | null;
  billing_details: { email?: string; address?: string; notes?: string } | null;
  address: string | null;
  postal_code: string | null;
  country: string | null;
  notes: string | null;
  gdpr_consent_at: string | null;
  marketing_consent: boolean;
  created_at: string;
};

export function customerName(c: Pick<CustomerListItem, "customer_type" | "full_name" | "company_name">) {
  return (c.customer_type === "company" ? c.company_name : c.full_name) ?? "—";
}

const LIST_COLUMNS =
  "id, customer_type, full_name, company_name, id_document_type, id_document_number, tax_id, phone, email, city, driving_licence_expiry, archived_at, anonymized_at";

export async function listCustomers(opts: { q?: string; type?: string; archived?: boolean; page: number }) {
  const supabase = await createClient();
  let query = supabase.from("customers").select(LIST_COLUMNS, { count: "exact" });
  query = opts.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (opts.type === "individual" || opts.type === "company") query = query.eq("customer_type", opts.type);
  const q = sanitizeSearch(opts.q);
  if (q) {
    const compact = q.replace(/[\s.-]/g, "").toUpperCase();
    const digits = q.replace(/\D/g, "");
    const parts = [
      `full_name.ilike.*${q}*`,
      `company_name.ilike.*${q}*`,
      `legal_name.ilike.*${q}*`,
      `representative_name.ilike.*${q}*`,
      `email.ilike.*${q}*`,
      `id_document_number.ilike.*${compact}*`,
      `tax_id.ilike.*${compact}*`,
    ];
    if (digits.length >= 3) parts.push(`phone.ilike.*${digits.split("").join("*")}*`);
    query = query.or(parts.join(","));
  }
  const from = (opts.page - 1) * CUSTOMERS_PAGE_SIZE;
  const { data, error, count } = await query
    .order("full_name", { nullsFirst: false })
    .order("company_name", { nullsFirst: false })
    .range(from, from + CUSTOMERS_PAGE_SIZE - 1);
  if (error) {
    console.error("[customers] list failed", error.code, error.message);
    return { ok: false as const };
  }
  return { ok: true as const, total: count ?? 0, items: (data ?? []) as CustomerListItem[] };
}

export async function getCustomer(id: string): Promise<CustomerDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return data as CustomerDetail;
}

export type CustomerSummary = {
  rentals: number;
  active: number;
  billed: number;
  paid: number;
  vehicles: number;
  last_rental: string | null;
};

export async function getCustomerSummary(id: string): Promise<CustomerSummary | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("customer_summary", { p_customer_id: id });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  return {
    rentals: Number(d.rentals ?? 0),
    active: Number(d.active ?? 0),
    billed: Number(d.billed ?? 0),
    paid: Number(d.paid ?? 0),
    vehicles: Number(d.vehicles ?? 0),
    last_rental: (d.last_rental as string | null) ?? null,
  };
}

export async function listCustomerRentals(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("rentals")
    .select("id, contract_number, status, pickup_at, return_at, total_amount, vehicles(brand, model, plate)")
    .eq("customer_id", id)
    .order("pickup_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => {
    const v = (Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles) as { brand: string; model: string; plate: string } | null;
    return {
      id: r.id as string,
      contract_number: r.contract_number as string,
      status: r.status as string,
      pickup_at: r.pickup_at as string,
      return_at: r.return_at as string,
      total_amount: Number(r.total_amount),
      vehicle: v ? `${v.brand} ${v.model} · ${v.plate}` : null,
    };
  });
}

export async function listCustomerPayments(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("financial_transactions")
    .select("id, description, category, amount, competence_date, paid_at, status")
    .eq("customer_id", id)
    .eq("type", "income")
    .is("archived_at", null)
    .order("competence_date", { ascending: false })
    .limit(50);
  return data ?? [];
}

export type CustomerDocument = {
  id: string;
  doc_type: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  expires_at: string | null;
  created_at: string;
};

export async function listCustomerDocuments(id: string): Promise<CustomerDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_documents")
    .select("id, doc_type, title, mime_type, size_bytes, expires_at, created_at")
    .eq("customer_id", id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return (data ?? []) as CustomerDocument[];
}
