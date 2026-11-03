import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type PortalMe = {
  customer_id: string;
  name: string;
  customer_type: string;
  email: string | null;
  phone: string | null;
  driving_licence_expiry: string | null;
  company: { name: string; legal_name: string | null; phone: string | null; email: string | null; address: string | null; city: string | null; default_locale: string };
};

/** Cliente do portal autenticado (memoizado por requisição); null = sem acesso. */
export const getPortalMe = cache(async (): Promise<PortalMe | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase.rpc("portal_me");
  if (error || !data) return null;
  return data as PortalMe;
});

export type PortalRental = {
  id: string;
  contract_number: string;
  status: "reservation" | "confirmed" | "in_progress" | "late" | "completed" | "cancelled";
  pickup_at: string;
  return_at: string;
  actual_return_at: string | null;
  vehicle: string;
  plate: string;
  pickup_location: string | null;
  return_location: string | null;
  total_amount: number;
  paid: number;
  balance: number;
  deposit_amount: number;
  deposit_status: "not_received" | "held" | "settled" | null;
  deposit_balance: number | null;
  signature_status: "unsigned" | "pending" | "signed";
  contract_locale: "pt-BR" | "es-ES";
};

export async function getPortalRentals(): Promise<PortalRental[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_rentals");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as PortalRental),
    total_amount: Number(r.total_amount),
    paid: Number(r.paid),
    balance: Number(r.balance),
    deposit_amount: Number(r.deposit_amount),
    deposit_balance: n(r.deposit_balance),
  }));
}

export async function getPortalPayments(rentalId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_rental_payments", { p_rental: rentalId });
  return ((data ?? []) as Array<{ kind: "payment" | "refund"; amount: number; paid_at: string; method: string }>).map((p) => ({ ...p, amount: Number(p.amount) }));
}

export async function getPortalDocuments() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_documents");
  return (data ?? []) as Array<{ kind: "customer-doc" | "rental-doc"; id: string; title: string; category: string; expires_at: string | null; created_at: string; contract_number: string | null }>;
}

export async function getPortalFines() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_fines");
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    kind: r.kind as "fine" | "accident",
    id: r.id as string,
    occurred_at: r.occurred_at as string,
    description: r.description as string,
    plate: r.plate as string,
    contract_number: (r.contract_number as string) ?? null,
    status: r.status as string,
    amount: n(r.amount),
    charged: n(r.charged),
    charged_paid_at: (r.charged_paid_at as string) ?? null,
  }));
}

export async function getPortalRequests() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_requests");
  return (data ?? []) as Array<{ id: string; pickup_at: string; return_at: string; vehicle_preference: string | null; notes: string | null; status: "new" | "contacted" | "converted" | "declined"; created_at: string }>;
}
