"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { uuidSchema } from "@/lib/validation/common";
import { entrySchema, openingBalanceSchema, payEntrySchema, vehicleSaleSchema } from "@/lib/validation/finance";
import { addMonthsKeepDay, splitInstallments } from "@/lib/finance/constants";

function revalidate(vehicleId?: string | null) {
  revalidatePath("/financial");
  revalidatePath("/assets");
  revalidatePath("/dashboard");
  if (vehicleId) revalidatePath(`/vehicles/${vehicleId}`);
}

/** Cria (com parcelas mensais opcionais) ou edita um lançamento manual. */
export async function saveEntryAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = entrySchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, installments, status, paid_at, ...v } = parsed.data;
  const row = { ...v, category: v.category, status, paid_at: status === "paid" ? paid_at : null };
  const supabase = await createClient();

  if (id) {
    const { error } = await supabase.from("financial_transactions").update(row).eq("id", id).eq("status", "pending");
    if (error) return { error: mapDbError(error) };
    revalidate(v.vehicle_id);
    return { ok: true };
  }

  const n = installments ?? 1;
  if (n === 1) {
    const { error } = await supabase.from("financial_transactions").insert(row);
    if (error) return { error: mapDbError(error) };
  } else {
    const series = crypto.randomUUID();
    const amounts = splitInstallments(v.amount, n);
    const firstDue = v.due_date ?? v.competence_date;
    const rows = amounts.map((amount, i) => ({
      ...row,
      amount,
      description: `${v.description} (${i + 1}/${n})`,
      competence_date: addMonthsKeepDay(v.competence_date, i),
      due_date: addMonthsKeepDay(firstDue, i),
      series_id: series,
      installment_no: i + 1,
      installment_count: n,
    }));
    const { error } = await supabase.from("financial_transactions").insert(rows);
    if (error) return { error: mapDbError(error) };
  }
  revalidate(v.vehicle_id);
  return { ok: true };
}

export async function payEntryAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = payEntrySchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_transactions")
    .update({ status: "paid", ...v })
    .eq("id", id)
    .eq("status", "pending")
    .select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "invalidStatusTransition" };
  revalidate(data[0].vehicle_id);
  return { ok: true };
}

/** Anula um lançamento manual (nunca exclui). */
export async function cancelEntryAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_transactions")
    .update({ status: "cancelled", paid_at: null })
    .eq("id", id)
    .neq("status", "cancelled")
    .select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidate(data[0].vehicle_id);
  return { ok: true };
}

export async function saveOpeningBalanceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = openingBalanceSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("companies").update(parsed.data).eq("id", guard.profile.companyId);
  if (error) return { error: mapDbError(error) };
  revalidatePath("/financial");
  return { ok: true };
}

/** Registra a venda do veículo (somente administrador principal). */
export async function sellVehicleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = vehicleSaleSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { vehicle_id, ...v } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicles").update(v).eq("id", vehicle_id).select("id");
  if (error) {
    const key = mapDbError(error);
    if (key === "saleBeforeAcquisition") return { fieldErrors: { sold_at: key } };
    return { error: key };
  }
  if (!data?.[0]) return { error: "notFound" };
  revalidate(vehicle_id);
  revalidatePath("/vehicles");
  return { ok: true };
}

export async function undoVehicleSaleAction(vehicleId: string): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(vehicleId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update({ sold_at: null, sale_price: null, sale_notes: null }).eq("id", vehicleId);
  if (error) return { error: mapDbError(error) };
  revalidate(vehicleId);
  revalidatePath("/vehicles");
  return { ok: true };
}
