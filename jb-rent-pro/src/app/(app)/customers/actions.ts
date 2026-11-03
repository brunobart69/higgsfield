"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { removeObject, verifyUpload } from "@/lib/files/server";
import { BUCKET, DOCUMENT_TYPES } from "@/lib/files/constants";
import { uuidSchema } from "@/lib/validation/common";
import { customerDocumentSchema, customerSchema, toCustomerRow } from "@/lib/validation/customers";

function duplicateField(type: string) {
  return type === "company" ? { tax_id: "duplicate" } : { id_document_number: "duplicate" };
}

export async function createCustomerAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = customerSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("customers").insert(toCustomerRow(parsed.data, null) as Record<string, unknown>).select("id").single();
  if (error) {
    const key = mapDbError(error);
    return key === "duplicate" ? { fieldErrors: duplicateField(parsed.data.customer_type) } : { error: key };
  }
  revalidatePath("/customers");
  redirect(`/customers/${data.id}?created=1`);
}

export async function updateCustomerAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const parsed = customerSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: before } = await supabase.from("customers").select("gdpr_consent_at, anonymized_at").eq("id", id).maybeSingle();
  if (!before) return { error: "notFound" };
  if (before.anonymized_at) return { error: "forbidden" };
  const { data, error } = await supabase
    .from("customers")
    .update(toCustomerRow(parsed.data, before.gdpr_consent_at) as Record<string, unknown>)
    .eq("id", id)
    .select("id");
  if (error) {
    const key = mapDbError(error);
    return key === "duplicate" ? { fieldErrors: duplicateField(parsed.data.customer_type) } : { error: key };
  }
  if (!data?.length) return { error: "notFound" };
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  redirect(`/customers/${id}?saved=1`);
}

export async function setCustomerArchivedAction(id: string, archived: boolean): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .is("anonymized_at", null)
    .select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { ok: true, message: archived ? "archivedOk" : "restoredOk" };
}

export async function registerCustomerDocumentAction(input: {
  customer_id: string;
  path: string;
  doc_type: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  expires_at?: string;
}): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = customerDocumentSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();

  const prefix = `${guard.profile.companyId}/customers/${d.customer_id}/`;
  const check = await verifyUpload(supabase, d.path, prefix, DOCUMENT_TYPES);
  if (!check.ok) {
    await removeObject(supabase, d.path);
    return { error: check.error };
  }
  const { error } = await supabase.from("customer_documents").insert({
    customer_id: d.customer_id,
    doc_type: d.doc_type,
    title: d.title,
    storage_path: d.path,
    mime_type: check.mime,
    size_bytes: check.size || d.size_bytes,
    expires_at: d.expires_at,
  });
  if (error) {
    await removeObject(supabase, d.path);
    return { error: mapDbError(error) };
  }
  revalidatePath(`/customers/${d.customer_id}`);
  return { ok: true };
}

/** Exclusão definitiva de documento pessoal: somente o administrador principal (RLS idem). */
export async function deleteCustomerDocumentAction(docId: string): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(docId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("customer_documents").delete().eq("id", docId).select("customer_id, storage_path");
  if (error) return { error: mapDbError(error) };
  const row = data?.[0];
  if (!row) return { error: "notFound" };
  await removeObject(supabase, row.storage_path);
  revalidatePath(`/customers/${row.customer_id}`);
  return { ok: true, message: "removed" };
}

/** RGPD: apaga dados pessoais e arquivos do cliente, mantendo o histórico contábil. */
export async function anonymizeCustomerAction(id: string): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("anonymize_customer", { p_customer_id: id });
  if (error) return { error: mapDbError(error) };
  const paths = (Array.isArray(data) ? data : []).map((r) => (typeof r === "string" ? r : String(Object.values(r)[0])));
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { ok: true, message: "done" };
}
