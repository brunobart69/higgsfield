"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { inviteSchema, roleSchema, userIdSchema } from "@/lib/validation/users";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { siteUrl } from "@/lib/site";

const BAN_FOREVER = "876000h"; // ~100 anos: encerra e bloqueia sessões de usuários desativados

/**
 * Convite: o Supabase envia o e-mail; em seguida gravamos empresa e cargo em
 * app_metadata (somente service_role pode), o que cria o perfil no banco.
 */
export async function inviteUserAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };

  const parsed = inviteSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error), values: { email: String(formData.get("email") ?? "") } };
  if (!isAdminConfigured()) return { error: "serviceKeyMissing" };

  const { email, full_name, role } = parsed.data;
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name },
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error || !data.user) {
    const exists = error?.status === 422 || /already (been )?registered|already exists/i.test(error?.message ?? "");
    console.error("[users] invite failed", error?.status, error?.message);
    return { error: exists ? "userExists" : "inviteFailed", values: { email } };
  }

  const { error: metaError } = await admin.auth.admin.updateUserById(data.user.id, {
    app_metadata: { company_id: guard.profile.companyId, role },
  });
  if (metaError) {
    console.error("[users] app_metadata failed, rolling back", metaError.message);
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: "inviteFailed", values: { email } };
  }

  const supabase = await createClient();
  await supabase.rpc("log_event", {
    p_action: "user.invite",
    p_entity: "profiles",
    p_entity_id: data.user.id,
    p_details: { email, role },
  });

  revalidatePath("/users");
  return { ok: true, message: "inviteSent", vars: { email } };
}

export async function changeRoleAction(userId: string, role: string): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = roleSchema.safeParse({ user_id: userId, role });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.user_id === guard.profile.id) return { error: "cannotChangeSelf" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.user_id)
    .select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };

  revalidatePath("/users");
  return { ok: true, message: "roleChanged" };
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = userIdSchema.safeParse({ user_id: userId });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.user_id === guard.profile.id) return { error: "cannotChangeSelf" };

  // 1) Banco (fonte da verdade, com auditoria): sem perfil ativo não há acesso aos dados (RLS).
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: active })
    .eq("id", parsed.data.user_id)
    .select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };

  // 2) Auth: bloqueia novos logins e invalida a renovação das sessões abertas.
  if (isAdminConfigured()) {
    const admin = createAdminClient();
    const { error: banError } = await admin.auth.admin.updateUserById(parsed.data.user_id, {
      ban_duration: active ? "none" : BAN_FOREVER,
    });
    if (banError) console.error("[users] ban update failed", banError.message);
    else if (!active) {
      await supabase.rpc("log_event", {
        p_action: "user.sessions_revoked",
        p_entity: "profiles",
        p_entity_id: parsed.data.user_id,
      });
    }
  }

  revalidatePath("/users");
  return { ok: true, message: active ? "reactivated" : "deactivated" };
}

export async function sendPasswordLinkAction(userId: string): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = userIdSchema.safeParse({ user_id: userId });
  if (!parsed.success) return { error: "invalid" };

  const supabase = await createClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .select("id, email, is_active")
    .eq("id", parsed.data.user_id)
    .maybeSingle();
  if (error) return { error: mapDbError(error) };
  if (!target) return { error: "notFound" };
  if (!target.is_active) return { error: "forbidden" };

  const { error: resetError } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${await siteUrl()}/auth/confirm?next=/reset-password`,
  });
  if (resetError) {
    console.error("[users] reset link failed", resetError.message);
    return { error: resetError.status === 429 ? "rateLimited" : "generic" };
  }
  await supabase.rpc("log_event", {
    p_action: "user.password_link",
    p_entity: "profiles",
    p_entity_id: target.id,
  });
  return { ok: true, message: "resetSent", vars: { email: target.email } };
}
