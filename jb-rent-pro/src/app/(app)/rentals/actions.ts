"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { sanitizeSearch } from "@/lib/search";
import { uuidSchema } from "@/lib/validation/common";
import {
  cancelSchema,
  depositReceiveSchema,
  depositSettleSchema,
  paymentSchema,
  pickupSchema,
  rentalSchema,
  returnSchema,
  voidPaymentSchema,
} from "@/lib/validation/rentals";

function revalidateRental(id?: string) {
  revalidatePath("/rentals");
  revalidatePath("/deposits");
  revalidatePath("/dashboard");
  revalidatePath("/vehicles");
  if (id) revalidatePath(`/rentals/${id}`);
}

/** Erros do banco que pertencem a um campo específico do formulário. */
function fieldFor(key: string): Record<string, string> | null {
  if (key === "bookingConflict") return { vehicle_id: "bookingConflict" };
  if (key === "vehicleNotRentable") return { vehicle_id: "vehicleNotRentable" };
  if (key === "discountTooHigh") return { discount_amount: "discountTooHigh" };
  return null;
}

async function saveRental(id: string | null, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = rentalSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { extras, ...data } = parsed.data;

  const supabase = await createClient();
  const { data: savedId, error } = await supabase.rpc("save_rental", { p_id: id, p_data: data, p_extras: extras });
  if (error) {
    const key = mapDbError(error);
    const field = fieldFor(key);
    return field ? { fieldErrors: field } : { error: key };
  }
  revalidateRental(String(savedId));
  redirect(`/rentals/${savedId}?saved=1`);
}

export async function createRentalAction(_p: FormState, fd: FormData) {
  return saveRental(null, fd);
}

export async function updateRentalAction(id: string, _p: FormState, fd: FormData) {
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  return saveRental(id, fd);
}

/** Busca de clientes para o seletor do formulário. */
export async function searchCustomersAction(q: string) {
  const guard = await requireStaff();
  if (!guard.ok) return [];
  const term = sanitizeSearch(q, 40);
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, customer_type, full_name, company_name, id_document_number, tax_id, phone, driving_licence_expiry")
    .is("archived_at", null)
    .limit(12);
  if (term) {
    const compact = term.replace(/[\s.-]/g, "").toUpperCase();
    query = query.or(
      `full_name.ilike.*${term}*,company_name.ilike.*${term}*,id_document_number.ilike.*${compact}*,tax_id.ilike.*${compact}*,phone.ilike.*${term}*,email.ilike.*${term}*`,
    );
  } else {
    query = query.order("created_at", { ascending: false });
  }
  const { data } = await query;
  return (data ?? []).map((c) => ({
    id: c.id as string,
    name: ((c.customer_type === "company" ? c.company_name : c.full_name) ?? "—") as string,
    detail: [c.id_document_number ?? c.tax_id, c.phone].filter(Boolean).join(" · "),
    licence_expiry: (c.driving_licence_expiry as string | null) ?? null,
  }));
}

export async function checkConflictsAction(vehicleId: string, pickupAt: string, returnAt: string, excludeId?: string | null) {
  const guard = await requireStaff();
  if (!guard.ok) return { ok: false as const };
  if (!uuidSchema.safeParse(vehicleId).success || !pickupAt || !returnAt) return { ok: false as const };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vehicle_conflicts", {
    p_vehicle_id: vehicleId,
    p_from: pickupAt,
    p_to: returnAt,
    p_exclude: excludeId || null,
  });
  if (error) return { ok: false as const };
  return { ok: true as const, conflicts: (data ?? []) as Array<{ id: string; contract_number: string; status: string; pickup_at: string; return_at: string }> };
}

async function updateRental(id: string, patch: Record<string, unknown>, message: string): Promise<FormState> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rentals").update(patch).eq("id", id).select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidateRental(id);
  return { ok: true, message };
}

export async function confirmRentalAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  return updateRental(id, { status: "confirmed" }, "confirmed");
}

export async function pickupRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = pickupSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const p = parsed.data;
  const supabase = await createClient();
  const { data: r } = await supabase.from("rentals").select("vehicle_id, vehicles(current_mileage)").eq("id", p.rental_id).maybeSingle();
  const veh = Array.isArray(r?.vehicles) ? r?.vehicles[0] : r?.vehicles;
  if (veh && p.start_mileage < Number((veh as { current_mileage: number }).current_mileage)) {
    return { fieldErrors: { start_mileage: "mileageDecrease" } };
  }
  return updateRental(p.rental_id, { status: "in_progress", start_mileage: p.start_mileage, start_fuel_level: p.start_fuel_level }, "done");
}

export async function returnRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = returnSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const p = parsed.data;
  const supabase = await createClient();
  const { data: r } = await supabase.from("rentals").select("start_mileage, extra_fees_amount, pickup_at").eq("id", p.rental_id).maybeSingle();
  if (!r) return { error: "notFound" };
  if (r.start_mileage !== null && p.end_mileage < Number(r.start_mileage)) return { fieldErrors: { end_mileage: "mileageBelowStart" } };
  if (new Date(p.actual_return_at).getTime() <= new Date(r.pickup_at).getTime()) return { fieldErrors: { return_date: "returnBeforePickup" } };
  const fees = (Math.round(Number(r.extra_fees_amount) * 100) + Math.round(Number(p.late_fee) * 100)) / 100;
  return updateRental(
    p.rental_id,
    {
      status: "completed",
      end_mileage: p.end_mileage,
      end_fuel_level: p.end_fuel_level,
      actual_return_at: p.actual_return_at,
      extra_fees_amount: fees.toFixed(2),
      return_notes: p.return_notes,
    },
    "done",
  );
}

export async function cancelRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = cancelSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  return updateRental(parsed.data.rental_id, { status: "cancelled", cancelled_reason: parsed.data.cancelled_reason }, "done");
}

export async function addPaymentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = paymentSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("rental_payments").insert(parsed.data);
  if (error) return { error: mapDbError(error) };
  revalidateRental(parsed.data.rental_id);
  return { ok: true, message: "saved" };
}

export async function voidPaymentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = voidPaymentSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rental_payments")
    .update({ voided_at: new Date().toISOString(), void_reason: parsed.data.void_reason })
    .eq("id", parsed.data.payment_id)
    .is("voided_at", null)
    .select("rental_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidateRental(data[0].rental_id);
  return { ok: true, message: "voidedOk" };
}

export async function receiveDepositAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = depositReceiveSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { rental_id, ...values } = parsed.data;
  const supabase = await createClient();
  const { data: rental } = await supabase.from("rentals").select("customer_id, vehicle_id").eq("id", rental_id).maybeSingle();
  if (!rental) return { error: "notFound" };
  const { error } = await supabase
    .from("deposits")
    .upsert({ rental_id, customer_id: rental.customer_id, vehicle_id: rental.vehicle_id, ...values }, { onConflict: "rental_id" });
  if (error) return { error: mapDbError(error) };
  revalidateRental(rental_id);
  return { ok: true, message: "saved" };
}

export async function settleDepositAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = depositSettleSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { rental_id, ...values } = parsed.data;
  const supabase = await createClient();
  const { data: dep } = await supabase.from("deposits").select("amount_received").eq("rental_id", rental_id).maybeSingle();
  if (!dep) return { error: "notFound" };
  const totalOut = Math.round(Number(values.amount_returned) * 100) + Math.round(Number(values.amount_retained) * 100);
  if (totalOut > Math.round(Number(dep.amount_received) * 100)) return { fieldErrors: { amount_returned: "invalidAmount" } };
  const { error } = await supabase
    .from("deposits")
    .update({
      amount_returned: values.amount_returned,
      returned_at: Number(values.amount_returned) > 0 ? values.returned_at : null,
      returned_method: Number(values.amount_returned) > 0 ? values.returned_method : null,
      amount_retained: values.amount_retained,
      retention_reason: Number(values.amount_retained) > 0 ? values.retention_reason : null,
    })
    .eq("rental_id", rental_id);
  if (error) return { error: mapDbError(error) };
  revalidateRental(rental_id);
  return { ok: true, message: "saved" };
}
