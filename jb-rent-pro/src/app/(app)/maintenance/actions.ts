"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { uuidSchema } from "@/lib/validation/common";
import { completeMaintenanceSchema, maintenanceSchema, planSchema } from "@/lib/validation/maintenance";

function revalidate(vehicleId?: string | null, id?: string | null, damageId?: string | null) {
  revalidatePath("/maintenance");
  revalidatePath("/dashboard");
  if (vehicleId) revalidatePath(`/vehicles/${vehicleId}`);
  if (id) revalidatePath(`/maintenance/${id}`);
  if (damageId) revalidatePath(`/damages/${damageId}`);
}

export async function saveMaintenanceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = maintenanceSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from("maintenance_records").update(values).eq("id", id).select("id").single()
    : supabase.from("maintenance_records").insert({ ...values, status: "scheduled" }).select("id").single();
  const { data, error } = await q;
  if (error) return { error: mapDbError(error) };
  revalidate(values.vehicle_id, data.id, values.damage_id);
  return { ok: true, message: "saved", vars: { id: data.id } };
}

export async function startMaintenanceAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("maintenance_records").update({ status: "in_progress" }).eq("id", id).eq("status", "scheduled").select("vehicle_id, damage_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "invalidStatusTransition" };
  revalidate(data[0].vehicle_id, id, data[0].damage_id);
  return { ok: true };
}

/** Conclui (de agendada ou em andamento) ou, se já concluída, atualiza pagamento e fatura. */
export async function completeMaintenanceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = completeMaintenanceSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { data: cur } = await supabase.from("maintenance_records").select("status").eq("id", id).maybeSingle();
  if (!cur) return { error: "notFound" };
  if (cur.status === "cancelled") return { error: "maintenanceLocked" };
  const patch =
    cur.status === "completed"
      ? { cost: values.cost, invoice_number: values.invoice_number, paid_at: values.paid_at, payment_method: values.payment_method, workshop: values.workshop, notes: values.notes }
      : { ...values, status: "completed" };
  const { data, error } = await supabase.from("maintenance_records").update(patch).eq("id", id).select("vehicle_id, damage_id");
  if (error) {
    const key = mapDbError(error);
    if (key === "maintenanceDataRequired") return { fieldErrors: { mileage: key } };
    return { error: key };
  }
  revalidate(data?.[0]?.vehicle_id, id, data?.[0]?.damage_id);
  return { ok: true };
}

export async function cancelMaintenanceAction(id: string, reason: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const r = reason.trim().slice(0, 500);
  if (!r) return { error: "cancelReasonRequired" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("maintenance_records")
    .update({ status: "cancelled", cancel_reason: r })
    .eq("id", id)
    .in("status", ["scheduled", "in_progress"])
    .select("vehicle_id, damage_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "invalidStatusTransition" };
  revalidate(data[0].vehicle_id, id, data[0].damage_id);
  return { ok: true };
}

export async function savePlanAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = planSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from("maintenance_plans").update(values).eq("id", id).select("id").single()
    : supabase.from("maintenance_plans").insert(values).select("id").single();
  const { error } = await q;
  if (error) return { error: mapDbError(error) };
  revalidate(values.vehicle_id);
  return { ok: true };
}

export async function archivePlanAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("maintenance_plans").update({ archived_at: new Date().toISOString() }).eq("id", id).select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidate(data[0].vehicle_id);
  return { ok: true };
}
