"use server";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  companySchema,
  contractSchema,
  defaultsSchema,
  feeSchema,
  fiscalSchema,
} from "@/lib/validation/settings";
import { uuidSchema } from "@/lib/validation/common";

/** Valida a seção e grava em companies (RLS: somente o administrador principal). */
async function saveCompanySection<S extends z.ZodType>(schema: S, formData: FormData): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = schema.safeParse(formToObject(formData));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .update(parsed.data as Record<string, unknown>)
    .eq("id", guard.profile.companyId)
    .select("id");
  if (error) {
    console.error("[settings] save failed", error.code, error.message);
    return { error: mapDbError(error) };
  }
  if (!data?.length) return { error: "forbidden" };
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, message: "saved" };
}

export async function saveCompanyAction(_p: FormState, fd: FormData) {
  return saveCompanySection(companySchema, fd);
}
export async function saveFiscalAction(_p: FormState, fd: FormData) {
  return saveCompanySection(fiscalSchema, fd);
}
export async function saveDefaultsAction(_p: FormState, fd: FormData) {
  return saveCompanySection(defaultsSchema, fd);
}
export async function saveContractAction(_p: FormState, fd: FormData) {
  return saveCompanySection(contractSchema, fd);
}

export async function saveFeeAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const parsed = feeSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;

  const supabase = await createClient();
  const query = id
    ? supabase.from("fee_catalog").update(values).eq("id", id).select("id")
    : supabase.from("fee_catalog").insert(values).select("id");
  const { data, error } = await query;
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidatePath("/settings");
  return { ok: true, message: "saved" };
}

export async function deleteFeeAction(id: string): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fee_catalog").delete().eq("id", id).select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidatePath("/settings");
  return { ok: true, message: "removed" };
}

/** Verifica a assinatura binária do arquivo (não confia apenas no MIME informado pelo navegador). */
function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export async function uploadLogoAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const file = fd.get("logo");
  if (!(file instanceof File) || file.size === 0) return { fieldErrors: { logo: "required" } };
  if (file.size > LOGO_MAX_BYTES) return { fieldErrors: { logo: "fileTooLarge" }, vars: { max: "2 MB" } };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type || !(LOGO_TYPES as readonly string[]).includes(type)) return { fieldErrors: { logo: "fileType" } };

  const supabase = await createClient();
  const path = `${guard.profile.companyId}/branding/logo-${Date.now()}.${type === "image/png" ? "png" : "jpg"}`;
  const { error: upErr } = await supabase.storage.from("documents").upload(path, bytes, {
    contentType: type,
    upsert: false,
    cacheControl: "3600",
  });
  if (upErr) {
    console.error("[settings] logo upload failed", upErr.message);
    return { error: "uploadFailed" };
  }

  const { data: previous } = await supabase.from("companies").select("logo_path").eq("id", guard.profile.companyId).maybeSingle();
  const { error } = await supabase.from("companies").update({ logo_path: path }).eq("id", guard.profile.companyId);
  if (error) {
    await supabase.storage.from("documents").remove([path]);
    return { error: mapDbError(error) };
  }
  if (previous?.logo_path && previous.logo_path !== path) {
    await supabase.storage.from("documents").remove([previous.logo_path]);
  }
  await supabase.rpc("log_event", { p_action: "company.logo_updated", p_entity: "companies", p_entity_id: guard.profile.companyId });
  revalidatePath("/settings");
  return { ok: true, message: "uploaded" };
}

export async function removeLogoAction(): Promise<FormState> {
  const guard = await requireOwner();
  if (!guard.ok) return { error: guard.error };
  const supabase = await createClient();
  const { data: current } = await supabase.from("companies").select("logo_path").eq("id", guard.profile.companyId).maybeSingle();
  const { error } = await supabase.from("companies").update({ logo_path: null }).eq("id", guard.profile.companyId);
  if (error) return { error: mapDbError(error) };
  if (current?.logo_path) await supabase.storage.from("documents").remove([current.logo_path]);
  revalidatePath("/settings");
  return { ok: true, message: "saved" };
}
