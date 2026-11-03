"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { removeObject, verifyUpload } from "@/lib/files/server";
import { PHOTO_TYPES } from "@/lib/files/constants";
import { uuidSchema } from "@/lib/validation/common";
import { createInspectionSchema, damagePhotoSchema, damageSchema, inspectionDraftSchema, inspectionPhotoSchema } from "@/lib/validation/inspections";

function revalidateAll(paths: Array<string | null | undefined>) {
  revalidatePath("/inspections");
  revalidatePath("/dashboard");
  for (const p of paths) if (p) revalidatePath(p);
}

/** Abre (ou retoma) a inspeção: se já existir uma do mesmo tipo para o contrato, vai para ela. */
export async function startInspectionAction(fd: FormData) {
  const guard = await requireStaff();
  if (!guard.ok) redirect("/login");
  const parsed = createInspectionSchema.safeParse(formToObject(fd));
  if (!parsed.success) redirect("/inspections?error=invalid");
  const { vehicle_id, rental_id, inspection_type } = parsed.data;
  const supabase = await createClient();

  if (rental_id) {
    const { data: existing } = await supabase
      .from("inspections")
      .select("id")
      .eq("rental_id", rental_id)
      .eq("inspection_type", inspection_type)
      .maybeSingle();
    if (existing) redirect(`/inspections/${existing.id}`);
  }
  // km sugerida: contrato (entrega) ou veículo
  const { data: vehicle } = await supabase.from("vehicles").select("current_mileage").eq("id", vehicle_id).maybeSingle();
  const { data, error } = await supabase
    .from("inspections")
    .insert({ vehicle_id, rental_id, inspection_type, mileage: inspection_type === "return" ? null : (vehicle?.current_mileage ?? null) })
    .select("id")
    .single();
  if (error) redirect(`/inspections?error=${mapDbError(error)}`);
  revalidateAll([rental_id ? `/rentals/${rental_id}` : null, `/vehicles/${vehicle_id}`]);
  redirect(`/inspections/${data.id}`);
}

export async function saveInspectionAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = inspectionDraftSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, complete, ...values } = parsed.data;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("inspections")
    .select("rental_id, vehicle_id, inspection_type, vehicles(current_mileage), rentals(start_mileage)")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { error: "notFound" };
  if (complete === "1" && values.mileage !== null) {
    const rent = Array.isArray(current.rentals) ? current.rentals[0] : current.rentals;
    const start = (rent as { start_mileage: number | null } | null)?.start_mileage ?? null;
    if (current.inspection_type === "return" && start !== null && values.mileage < start) return { fieldErrors: { mileage: "mileageBelowStart" } };
  }

  const patch: Record<string, unknown> = { ...values };
  if (complete === "1") {
    patch.status = "completed";
    patch.completed_at = new Date().toISOString();
  }
  const { data, error } = await supabase.from("inspections").update(patch).eq("id", id).select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidateAll([`/inspections/${id}`, current.rental_id ? `/rentals/${current.rental_id}` : null, `/vehicles/${current.vehicle_id}`]);
  return { ok: true, message: complete === "1" ? "completed" : "saved" };
}

export async function discardInspectionAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data: photos } = await supabase.from("inspection_photos").select("storage_path").eq("inspection_id", id);
  const { data, error } = await supabase.from("inspections").delete().eq("id", id).eq("status", "draft").select("rental_id, vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  if (photos?.length) await supabase.storage.from("documents").remove(photos.map((p) => p.storage_path));
  revalidateAll([data[0].rental_id ? `/rentals/${data[0].rental_id}` : null, `/vehicles/${data[0].vehicle_id}`]);
  return { ok: true, message: "discarded" };
}

export async function registerInspectionPhotoAction(input: { inspection_id: string; path: string; area: string; size_bytes: number }): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = inspectionPhotoSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const p = parsed.data;
  const supabase = await createClient();
  const { data: insp } = await supabase.from("inspections").select("vehicle_id, status").eq("id", p.inspection_id).maybeSingle();
  if (!insp) return { error: "notFound" };
  if (insp.status === "completed") return { error: "inspectionLocked" };
  const prefix = `${guard.profile.companyId}/vehicles/${insp.vehicle_id}/inspections/${p.inspection_id}/`;
  const check = await verifyUpload(supabase, p.path, prefix, PHOTO_TYPES);
  if (!check.ok) {
    await removeObject(supabase, p.path);
    return { error: check.error };
  }
  const { error } = await supabase
    .from("inspection_photos")
    .insert({ inspection_id: p.inspection_id, area: p.area, storage_path: p.path, mime_type: check.mime, size_bytes: check.size || p.size_bytes });
  if (error) {
    await removeObject(supabase, p.path);
    return { error: mapDbError(error) };
  }
  revalidatePath(`/inspections/${p.inspection_id}`);
  return { ok: true };
}

export async function deleteInspectionPhotoAction(photoId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(photoId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("inspection_photos").delete().eq("id", photoId).select("inspection_id, storage_path");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  await removeObject(supabase, data[0].storage_path);
  revalidatePath(`/inspections/${data[0].inspection_id}`);
  return { ok: true };
}

export async function saveDamageAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = damageSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const row = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const q = id ? supabase.from("damages").update(row).eq("id", id).select("id").single() : supabase.from("damages").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { error: mapDbError(error) };
  revalidateAll([`/damages/${data.id}`, `/vehicles/${values.vehicle_id}`, values.rental_id ? `/rentals/${values.rental_id}` : null]);
  return { ok: true, message: "saved", vars: { id: data.id } };
}

export async function setDamageArchivedAction(id: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("damages").update({ archived_at: new Date().toISOString() }).eq("id", id).select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidateAll([`/vehicles/${data[0].vehicle_id}`]);
  return { ok: true };
}

export async function registerDamagePhotoAction(input: { damage_id: string; path: string; size_bytes: number }): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = damagePhotoSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const p = parsed.data;
  const supabase = await createClient();
  const { data: dmg } = await supabase.from("damages").select("vehicle_id").eq("id", p.damage_id).maybeSingle();
  if (!dmg) return { error: "notFound" };
  const prefix = `${guard.profile.companyId}/vehicles/${dmg.vehicle_id}/damages/${p.damage_id}/`;
  const check = await verifyUpload(supabase, p.path, prefix, PHOTO_TYPES);
  if (!check.ok) {
    await removeObject(supabase, p.path);
    return { error: check.error };
  }
  const { error } = await supabase
    .from("damage_photos")
    .insert({ damage_id: p.damage_id, storage_path: p.path, mime_type: check.mime, size_bytes: check.size || p.size_bytes });
  if (error) {
    await removeObject(supabase, p.path);
    return { error: mapDbError(error) };
  }
  revalidatePath(`/damages/${p.damage_id}`);
  return { ok: true };
}

export async function deleteDamagePhotoAction(photoId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(photoId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("damage_photos").delete().eq("id", photoId).select("damage_id, storage_path");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  await removeObject(supabase, data[0].storage_path);
  revalidatePath(`/damages/${data[0].damage_id}`);
  return { ok: true };
}
