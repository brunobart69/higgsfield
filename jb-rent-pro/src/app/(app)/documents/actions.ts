"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { mapDbError } from "@/lib/db-errors";
import { removeObject, verifyUpload } from "@/lib/files/server";
import { DOCUMENT_TYPES } from "@/lib/files/constants";
import { uuidSchema } from "@/lib/validation/common";
import { documentSchema } from "@/lib/validation/documents";

/** Pasta esperada conforme o vínculo do documento. */
function expectedPrefix(company: string, d: { vehicle_id: string | null; rental_id: string | null }) {
  if (d.vehicle_id) return `${company}/vehicles/${d.vehicle_id}/`;
  if (d.rental_id) return `${company}/rentals/${d.rental_id}/`;
  return `${company}/company/`;
}

export async function registerDocumentAction(input: Record<string, unknown>): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { path, ...d } = parsed.data;
  const supabase = await createClient();
  const check = await verifyUpload(supabase, path, expectedPrefix(guard.profile.companyId, d), DOCUMENT_TYPES);
  if (!check.ok) {
    await removeObject(supabase, path);
    return { error: check.error };
  }
  const { error } = await supabase.from("documents").insert({ ...d, storage_path: path, mime_type: check.mime, size_bytes: check.size || d.size_bytes });
  if (error) {
    await removeObject(supabase, path);
    return { error: mapDbError(error) };
  }
  if (d.category === "itv" && d.vehicle_id && d.expires_at) {
    await supabase.from("vehicles").update({ itv_due_date: d.expires_at }).eq("id", d.vehicle_id);
  }
  revalidatePath("/documents");
  revalidatePath("/dashboard");
  if (d.vehicle_id) revalidatePath(`/vehicles/${d.vehicle_id}`);
  if (d.rental_id) revalidatePath(`/rentals/${d.rental_id}`);
  if (d.insurance_policy_id) revalidatePath(`/insurance/${d.insurance_policy_id}`);
  if (d.maintenance_id) revalidatePath(`/maintenance/${d.maintenance_id}`);
  if (d.fine_id) revalidatePath(`/fines/${d.fine_id}`);
  if (d.accident_id) revalidatePath(`/fines/accidents/${d.accident_id}`);
  return { ok: true };
}

export async function archiveDocumentAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").update({ archived_at: new Date().toISOString() }).eq("id", id).select("vehicle_id, rental_id, insurance_policy_id, maintenance_id, fine_id, accident_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidatePath("/documents");
  const r = data[0];
  if (r.vehicle_id) revalidatePath(`/vehicles/${r.vehicle_id}`);
  if (r.rental_id) revalidatePath(`/rentals/${r.rental_id}`);
  if (r.insurance_policy_id) revalidatePath(`/insurance/${r.insurance_policy_id}`);
  if (r.maintenance_id) revalidatePath(`/maintenance/${r.maintenance_id}`);
  if (r.fine_id) revalidatePath(`/fines/${r.fine_id}`);
  if (r.accident_id) revalidatePath(`/fines/accidents/${r.accident_id}`);
  return { ok: true };
}

/**
 * Exclusão definitiva (somente administrador principal). Documentos da empresa
 * só podem ser excluídos depois do prazo de retenção (verificado no banco);
 * documentos pessoais de clientes podem ser excluídos a qualquer momento (RGPD).
 * Remove também o arquivo do Storage.
 */
export async function deleteDocumentAction(id: string, kind: "vehicle-doc" | "customer-doc"): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  let path: string | null = null;
  if (kind === "customer-doc") {
    const { data, error } = await supabase.from("customer_documents").delete().eq("id", id).select("storage_path");
    if (error) return { error: mapDbError(error) };
    path = data?.[0]?.storage_path ?? null;
  } else {
    const { data, error } = await supabase.rpc("purge_document", { p_id: id });
    if (error) return { error: error.message?.includes("RETENTION_ACTIVE") ? "retentionActive" : mapDbError(error) };
    path = (data as string | null) ?? null;
  }
  if (!path) return { error: "notFound" };
  await removeObject(supabase, path);
  revalidatePath("/documents");
  return { ok: true, message: "removed" };
}
