"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth/guards";
import type { FormState } from "@/lib/auth/validation";
import { mapDbError } from "@/lib/db-errors";
import { uuidSchema } from "@/lib/validation/common";

/**
 * Ativa a área do cliente: cria (ou reaproveita) a conta de autenticação SEM
 * empresa/cargo no app_metadata — portanto sem acesso ao painel — e a vincula
 * a este cliente. O cliente entra com um código enviado ao e-mail.
 */
export async function invitePortalAction(customerId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(customerId).success) return { error: "invalid" };
  if (!isAdminConfigured()) return { error: "serviceKeyMissing" };
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("customers")
    .select("id, email, full_name, company_name, customer_type, archived_at, anonymized_at")
    .eq("id", customerId)
    .maybeSingle();
  if (!c || c.archived_at || c.anonymized_at) return { error: "notFound" };
  const email = (c.email ?? "").trim().toLowerCase();
  if (!email) return { error: "customerEmailRequired" };

  const { data: existing } = await supabase.from("customer_portal_accounts").select("user_id, disabled_at").eq("customer_id", customerId).maybeSingle();
  if (existing) {
    if (existing.disabled_at) {
      const { error } = await supabase.from("customer_portal_accounts").update({ disabled_at: null }).eq("customer_id", customerId);
      if (error) return { error: mapDbError(error) };
    }
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, vars: { email } };
  }

  const admin = createAdminClient();
  const { data: found } = await admin.rpc("auth_user_id_by_email", { p_email: email });
  let userId = (found as string | null) ?? null;
  if (userId) {
    const { data: staff } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (staff) return { error: "portalStaffConflict" };
  } else {
    const name = (c.customer_type === "company" ? c.company_name : c.full_name) ?? "";
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name, portal: true } });
    if (error || !data.user) {
      console.error("[portal] create user failed", error?.status, error?.code);
      return { error: "inviteFailed" };
    }
    userId = data.user.id;
  }
  const { error } = await supabase.from("customer_portal_accounts").insert({ user_id: userId, customer_id: customerId, email, invited_by: guard.profile.id });
  if (error) {
    if (error.message?.includes("PORTAL_STAFF_CONFLICT")) return { error: "portalStaffConflict" };
    return { error: mapDbError(error) };
  }
  await supabase.rpc("log_event", { p_action: "portal.invited", p_entity: "customers", p_entity_id: customerId, p_details: { email } });
  revalidatePath(`/customers/${customerId}`);
  return { ok: true, vars: { email } };
}

export async function setPortalDisabledAction(customerId: string, disabled: boolean): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(customerId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_portal_accounts")
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq("customer_id", customerId)
    .select("user_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  if (disabled) await supabase.rpc("log_event", { p_action: "portal.disabled", p_entity: "customers", p_entity_id: customerId });
  revalidatePath(`/customers/${customerId}`);
  return { ok: true };
}
