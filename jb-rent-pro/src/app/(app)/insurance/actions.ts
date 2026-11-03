"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { uuidSchema } from "@/lib/validation/common";
import { insuranceSchema } from "@/lib/validation/insurance";

function revalidate(vehicleId?: string, id?: string) {
  revalidatePath("/insurance");
  revalidatePath("/dashboard");
  if (vehicleId) revalidatePath(`/vehicles/${vehicleId}`);
  if (id) revalidatePath(`/insurance/${id}`);
}

export async function saveInsuranceAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = insuranceSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from("insurance_policies").update(values).eq("id", id).select("id").single()
    : supabase.from("insurance_policies").insert(values).select("id").single();
  const { data, error } = await q;
  if (error) {
    const key = mapDbError(error);
    if (key === "duplicate") return { fieldErrors: { policy_number: "duplicate" } };
    if (error.message?.includes("RENEWAL_MISMATCH")) return { error: "renewalMismatch" };
    return { error: key };
  }
  revalidate(values.vehicle_id, data.id);
  if (values.renewed_from_id) revalidatePath(`/insurance/${values.renewed_from_id}`);
  return { ok: true, message: "saved", vars: { id: data.id } };
}

export async function archiveInsuranceAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("insurance_policies").update({ archived_at: new Date().toISOString() }).eq("id", id).select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidate(data[0].vehicle_id, id);
  return { ok: true };
}
