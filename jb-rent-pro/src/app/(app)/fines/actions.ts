"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { removeObject, verifyUpload } from "@/lib/files/server";
import { PHOTO_TYPES } from "@/lib/files/constants";
import { uuidSchema } from "@/lib/validation/common";
import { accidentPhotoSchema, accidentSchema, fineSchema } from "@/lib/validation/fines";

function revalidate(paths: Array<string | null | undefined>) {
  revalidatePath("/fines");
  revalidatePath("/dashboard");
  for (const p of paths) if (p) revalidatePath(p);
}

export async function saveFineAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = fineSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from("traffic_fines").update(values).eq("id", id).select("id, rental_id, customer_id").single()
    : supabase.from("traffic_fines").insert(values).select("id, rental_id, customer_id").single();
  const { data, error } = await q;
  if (error) {
    const key = mapDbError(error);
    if (key === "duplicate") return { fieldErrors: { reference: "duplicate" } };
    if (key === "customerRequired") return { fieldErrors: { status: key } };
    return { error: key };
  }
  revalidate([`/fines/${data.id}`, `/vehicles/${values.vehicle_id}`, data.rental_id && `/rentals/${data.rental_id}`, data.customer_id && `/customers/${data.customer_id}`]);
  return { ok: true, message: "saved", vars: { id: data.id } };
}

export async function archiveFineAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("traffic_fines").update({ archived_at: new Date().toISOString() }).eq("id", id).select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidate([`/vehicles/${data[0].vehicle_id}`]);
  return { ok: true };
}

export async function saveAccidentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = accidentSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const q = id
    ? supabase.from("accidents").update(values).eq("id", id).select("id, rental_id, customer_id").single()
    : supabase.from("accidents").insert(values).select("id, rental_id, customer_id").single();
  const { data, error } = await q;
  if (error) {
    const key = mapDbError(error);
    if (key === "customerRequired") return { fieldErrors: { deductible_amount: key } };
    return { error: key };
  }
  revalidate([`/fines/accidents/${data.id}`, `/vehicles/${values.vehicle_id}`, data.rental_id && `/rentals/${data.rental_id}`, data.customer_id && `/customers/${data.customer_id}`]);
  return { ok: true, message: "saved", vars: { id: data.id } };
}

export async function archiveAccidentAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("accidents").update({ archived_at: new Date().toISOString() }).eq("id", id).select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidate([`/vehicles/${data[0].vehicle_id}`]);
  return { ok: true };
}

export async function registerAccidentPhotoAction(input: { accident_id: string; path: string; size_bytes: number }): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = accidentPhotoSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const supabase = await createClient();
  const { data: acc } = await supabase.from("accidents").select("vehicle_id").eq("id", d.accident_id).maybeSingle();
  if (!acc) {
    await removeObject(supabase, d.path);
    return { error: "notFound" };
  }
  const prefix = `${guard.profile.companyId}/vehicles/${acc.vehicle_id}/accidents/${d.accident_id}/`;
  const check = await verifyUpload(supabase, d.path, prefix, PHOTO_TYPES);
  if (!check.ok) {
    await removeObject(supabase, d.path);
    return { error: check.error };
  }
  const { error } = await supabase.from("accident_photos").insert({ accident_id: d.accident_id, storage_path: d.path, mime_type: check.mime, size_bytes: check.size || d.size_bytes });
  if (error) {
    await removeObject(supabase, d.path);
    return { error: mapDbError(error) };
  }
  revalidatePath(`/fines/accidents/${d.accident_id}`);
  return { ok: true };
}

export async function deleteAccidentPhotoAction(photoId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(photoId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("accident_photos").delete().eq("id", photoId).select("accident_id, storage_path");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  await removeObject(supabase, data[0].storage_path);
  revalidatePath(`/fines/accidents/${data[0].accident_id}`);
  return { ok: true };
}
