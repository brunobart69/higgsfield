"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { formToObject, mapDbError } from "@/lib/db-errors";
import { removeObject, verifyUpload } from "@/lib/files/server";
import { DOCUMENT_TYPES, PHOTO_TYPES } from "@/lib/files/constants";
import { todayInMadrid } from "@/lib/periods";
import { uuidSchema } from "@/lib/validation/common";
import {
  photoRegisterSchema,
  vehicleDocumentSchema,
  vehicleSchema,
  vehicleStatusSchema,
  type VehicleInput,
} from "@/lib/validation/vehicles";

/** Registra a avaliação do dia quando o valor de mercado muda (alimenta a evolução do patrimônio). */
async function recordValuation(supabase: Awaited<ReturnType<typeof createClient>>, vehicleId: string, value: string | null) {
  if (value === null) return;
  await supabase
    .from("vehicle_valuations")
    .upsert({ vehicle_id: vehicleId, valuation_date: todayInMadrid(), value, source: "manual" }, { onConflict: "vehicle_id,valuation_date" });
}

function toRow(v: VehicleInput) {
  return { ...v };
}

export async function createVehicleAction(_p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = vehicleSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicles").insert(toRow(parsed.data)).select("id").single();
  if (error) {
    const key = mapDbError(error);
    return key === "duplicate" ? { fieldErrors: { plate: "duplicate" } } : { error: key };
  }
  await recordValuation(supabase, data.id, parsed.data.market_value);
  revalidatePath("/vehicles");
  revalidatePath("/dashboard");
  redirect(`/vehicles/${data.id}?created=1`);
}

export async function updateVehicleAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const parsed = vehicleSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: before } = await supabase.from("vehicles").select("market_value").eq("id", id).maybeSingle();
  const { data, error } = await supabase.from("vehicles").update(toRow(parsed.data)).eq("id", id).select("id");
  if (error) {
    const key = mapDbError(error);
    if (key === "duplicate") return { fieldErrors: { plate: "duplicate" } };
    if (key === "mileageDecrease") return { fieldErrors: { current_mileage: "mileageDecrease" } };
    return { error: key };
  }
  if (!data?.length) return { error: "notFound" };
  if (parsed.data.market_value !== null && Number(before?.market_value ?? NaN) !== Number(parsed.data.market_value)) {
    await recordValuation(supabase, id, parsed.data.market_value);
  }
  revalidatePath(`/vehicles/${id}`);
  revalidatePath("/vehicles");
  redirect(`/vehicles/${id}?saved=1`);
}

export async function setVehicleStatusAction(id: string, status: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = vehicleStatusSchema.safeParse({ id, status });
  if (!parsed.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicles").update({ status: parsed.data.status }).eq("id", id).select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidatePath(`/vehicles/${id}`);
  revalidatePath("/vehicles");
  return { ok: true, message: "statusChanged" };
}

export async function setVehicleArchivedAction(id: string, archived: boolean): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(id).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.length) return { error: "notFound" };
  revalidatePath(`/vehicles/${id}`);
  revalidatePath("/vehicles");
  return { ok: true, message: archived ? "archivedOk" : "restoredOk" };
}

/** Registra uma foto já enviada pelo navegador ao Storage (após verificar o conteúdo real). */
export async function registerVehiclePhotoAction(input: {
  vehicle_id: string;
  path: string;
  kind: string;
  mime_type: string;
  size_bytes: number;
  caption?: string | null;
}): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = photoRegisterSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const p = parsed.data;
  const supabase = await createClient();

  const prefix = `${guard.profile.companyId}/vehicles/${p.vehicle_id}/photos/`;
  const check = await verifyUpload(supabase, p.path, prefix, PHOTO_TYPES);
  if (!check.ok) {
    await removeObject(supabase, p.path);
    return { error: check.error };
  }
  if (p.kind === "main") {
    await supabase.from("vehicle_photos").update({ kind: "exterior" }).eq("vehicle_id", p.vehicle_id).eq("kind", "main");
  }
  const { error } = await supabase.from("vehicle_photos").insert({
    vehicle_id: p.vehicle_id,
    kind: p.kind,
    storage_path: p.path,
    mime_type: check.mime,
    size_bytes: check.size || p.size_bytes,
    caption: p.caption || null,
  });
  if (error) {
    await removeObject(supabase, p.path);
    return { error: mapDbError(error) };
  }
  revalidatePath(`/vehicles/${p.vehicle_id}`);
  revalidatePath("/vehicles");
  return { ok: true };
}

export async function setMainPhotoAction(photoId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(photoId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data: photo } = await supabase.from("vehicle_photos").select("id, vehicle_id").eq("id", photoId).maybeSingle();
  if (!photo) return { error: "notFound" };
  await supabase.from("vehicle_photos").update({ kind: "exterior" }).eq("vehicle_id", photo.vehicle_id).eq("kind", "main");
  const { error } = await supabase.from("vehicle_photos").update({ kind: "main" }).eq("id", photoId);
  if (error) return { error: mapDbError(error) };
  revalidatePath(`/vehicles/${photo.vehicle_id}`);
  revalidatePath("/vehicles");
  return { ok: true };
}

export async function deletePhotoAction(photoId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(photoId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicle_photos").delete().eq("id", photoId).select("vehicle_id, storage_path");
  if (error) return { error: mapDbError(error) };
  const row = data?.[0];
  if (!row) return { error: "notFound" };
  await removeObject(supabase, row.storage_path);
  revalidatePath(`/vehicles/${row.vehicle_id}`);
  revalidatePath("/vehicles");
  return { ok: true, message: "removed" };
}

export async function registerVehicleDocumentAction(input: {
  vehicle_id: string;
  path: string;
  category: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  issued_at?: string;
  expires_at?: string;
}): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const parsed = vehicleDocumentSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const d = parsed.data;
  const supabase = await createClient();

  const prefix = `${guard.profile.companyId}/vehicles/${d.vehicle_id}/documents/`;
  const check = await verifyUpload(supabase, d.path, prefix, DOCUMENT_TYPES);
  if (!check.ok) {
    await removeObject(supabase, d.path);
    return { error: check.error };
  }
  const { error } = await supabase.from("documents").insert({
    category: d.category,
    title: d.title,
    storage_path: d.path,
    mime_type: check.mime,
    size_bytes: check.size || d.size_bytes,
    vehicle_id: d.vehicle_id,
    issued_at: d.issued_at,
    expires_at: d.expires_at,
  });
  if (error) {
    await removeObject(supabase, d.path);
    return { error: mapDbError(error) };
  }
  // a validade da ITV também alimenta a ficha do veículo e os alertas
  if (d.category === "itv" && d.expires_at) {
    await supabase.from("vehicles").update({ itv_due_date: d.expires_at }).eq("id", d.vehicle_id);
  }
  revalidatePath(`/vehicles/${d.vehicle_id}`);
  return { ok: true };
}

export async function archiveVehicleDocumentAction(docId: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (!uuidSchema.safeParse(docId).success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", docId)
    .select("vehicle_id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidatePath(`/vehicles/${data[0].vehicle_id}`);
  return { ok: true };
}
