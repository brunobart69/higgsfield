import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "@/lib/search";
import { addDays, todayInMadrid } from "@/lib/periods";

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
export const DOCS_PAGE_SIZE = 30;

export type CenterDoc = {
  id: string;
  kind: "vehicle-doc" | "customer-doc";
  category: string;
  title: string;
  mime_type: string;
  size_bytes: number | null;
  issued_at: string | null;
  expires_at: string | null;
  retention_until: string | null;
  created_at: string;
  link: { href: string; label: string } | null;
};

export type DocFilter = { q?: string; scope: "company" | "customers"; category?: string; status?: "expiring" | "expired" | "retention"; page: number };

/** Documentos da central: empresa/veículos/contratos/apólices (documents) ou clientes (customer_documents). */
export async function listCenterDocuments(f: DocFilter) {
  const supabase = await createClient();
  const today = todayInMadrid();
  const q = sanitizeSearch(f.q);
  const from = (f.page - 1) * DOCS_PAGE_SIZE;

  if (f.scope === "customers") {
    let query = supabase
      .from("customer_documents")
      .select("id, doc_type, title, mime_type, size_bytes, expires_at, retention_until, created_at, customer_id, customers(full_name, company_name, customer_type)", { count: "exact" })
      .is("archived_at", null);
    if (f.category) query = query.eq("doc_type", f.category);
    if (q) query = query.ilike("title", `%${q}%`);
    if (f.status === "expiring") query = query.gte("expires_at", today).lte("expires_at", addDays(today, 30));
    if (f.status === "expired") query = query.lt("expires_at", today);
    if (f.status === "retention") query = query.lt("retention_until", today);
    const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + DOCS_PAGE_SIZE - 1);
    return {
      total: count ?? 0,
      items: (data ?? []).map((d) => {
        const c = one(d.customers as Rel<{ full_name: string | null; company_name: string | null; customer_type: string }>);
        return {
          id: d.id,
          kind: "customer-doc" as const,
          category: d.doc_type,
          title: d.title,
          mime_type: d.mime_type,
          size_bytes: d.size_bytes,
          issued_at: null,
          expires_at: d.expires_at,
          retention_until: d.retention_until,
          created_at: d.created_at,
          link: { href: `/customers/${d.customer_id}?tab=documents`, label: (c?.customer_type === "company" ? c?.company_name : c?.full_name) ?? "—" },
        } satisfies CenterDoc;
      }),
    };
  }

  let query = supabase
    .from("documents")
    .select(
      "id, category, title, mime_type, size_bytes, issued_at, expires_at, retention_until, created_at, vehicle_id, rental_id, insurance_policy_id, maintenance_id, fine_id, accident_id, vehicles(plate), rentals(contract_number), insurance_policies(insurer, policy_number)",
      { count: "exact" },
    )
    .is("archived_at", null);
  if (f.category) query = query.eq("category", f.category);
  if (q) query = query.ilike("title", `%${q}%`);
  if (f.status === "expiring") query = query.gte("expires_at", today).lte("expires_at", addDays(today, 30));
  if (f.status === "expired") query = query.lt("expires_at", today);
  if (f.status === "retention") query = query.lt("retention_until", today);
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + DOCS_PAGE_SIZE - 1);
  return {
    total: count ?? 0,
    items: (data ?? []).map((d) => {
      const v = one(d.vehicles as Rel<{ plate: string }>);
      const r = one(d.rentals as Rel<{ contract_number: string }>);
      const ip = one(d.insurance_policies as Rel<{ insurer: string; policy_number: string }>);
      const link = d.maintenance_id
        ? { href: `/maintenance/${d.maintenance_id}`, label: v?.plate ?? "—" }
        : d.fine_id
          ? { href: `/fines/${d.fine_id}`, label: v?.plate ?? "—" }
          : d.accident_id
            ? { href: `/fines/accidents/${d.accident_id}`, label: v?.plate ?? "—" }
            : d.insurance_policy_id
        ? { href: `/insurance/${d.insurance_policy_id}`, label: ip ? `${ip.insurer} · ${ip.policy_number}` : "—" }
        : d.rental_id
          ? { href: `/rentals/${d.rental_id}`, label: r?.contract_number ?? "—" }
          : d.vehicle_id
            ? { href: `/vehicles/${d.vehicle_id}?tab=documents`, label: v?.plate ?? "—" }
            : null;
      return {
        id: d.id,
        kind: "vehicle-doc" as const,
        category: d.category,
        title: d.title,
        mime_type: d.mime_type,
        size_bytes: d.size_bytes,
        issued_at: d.issued_at,
        expires_at: d.expires_at,
        retention_until: d.retention_until,
        created_at: d.created_at,
        link,
      } satisfies CenterDoc;
    }),
  };
}

export async function listLinkedDocuments(filter: { insurancePolicyId?: string; rentalId?: string; maintenanceId?: string; fineId?: string; accidentId?: string }) {
  const supabase = await createClient();
  let q = supabase.from("documents").select("id, category, title, mime_type, size_bytes, expires_at, created_at").is("archived_at", null);
  if (filter.insurancePolicyId) q = q.eq("insurance_policy_id", filter.insurancePolicyId);
  if (filter.rentalId) q = q.eq("rental_id", filter.rentalId);
  if (filter.maintenanceId) q = q.eq("maintenance_id", filter.maintenanceId);
  if (filter.fineId) q = q.eq("fine_id", filter.fineId);
  if (filter.accidentId) q = q.eq("accident_id", filter.accidentId);
  const { data } = await q.order("created_at", { ascending: false });
  return data ?? [];
}

/** Opções de vínculo no envio: veículos e contratos recentes. */
export async function getDocumentLinkOptions() {
  const supabase = await createClient();
  const [v, r] = await Promise.all([
    supabase.from("vehicles").select("id, brand, model, plate").is("archived_at", null).order("plate"),
    supabase.from("rentals").select("id, contract_number").is("archived_at", null).order("created_at", { ascending: false }).limit(100),
  ]);
  return {
    vehicles: (v.data ?? []).map((x) => ({ value: x.id as string, label: `${x.plate} · ${x.brand} ${x.model}` })),
    rentals: (r.data ?? []).map((x) => ({ value: x.id as string, label: x.contract_number as string })),
  };
}
