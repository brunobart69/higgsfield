import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET } from "@/lib/files/constants";
import type { InspectionDetail } from "@/lib/inspections/queries";
import type { CompanySettings } from "@/lib/settings/queries";
import type { PdfInspection, PdfPhoto } from "./inspection-pdf";

const MAX_PHOTOS = 36;

async function download(supabase: SupabaseClient, path: string): Promise<Uint8Array | null> {
  const { data } = await supabase.storage.from(BUCKET).download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

export async function loadLogo(supabase: SupabaseClient, company: CompanySettings) {
  if (!company.logo_path) return null;
  const bytes = await download(supabase, company.logo_path);
  return bytes ? { bytes, type: (company.logo_path.endsWith(".png") ? "png" : "jpg") as "png" | "jpg" } : null;
}

/** Converte a inspeção para o PDF, baixando as fotos (limite para manter o arquivo leve). */
export async function toPdfInspection(supabase: SupabaseClient, ins: InspectionDetail, names: Record<string, string>): Promise<PdfInspection> {
  const photos: PdfPhoto[] = [];
  for (const p of ins.photos.slice(0, MAX_PHOTOS)) {
    const bytes = await download(supabase, p.storage_path);
    if (bytes) photos.push({ area: p.area, bytes, type: p.storage_path.endsWith(".png") ? "png" : "jpg" });
  }
  return {
    inspection_type: ins.inspection_type,
    performed_at: ins.performed_at,
    completed_at: ins.completed_at,
    mileage: ins.mileage,
    fuel_level: ins.fuel_level,
    checklist: ins.checklist,
    customer_present: ins.customer_present,
    customer_name: ins.customer_name,
    existing_damages_confirmed: ins.existing_damages_confirmed,
    observations: ins.observations,
    inspector: ins.completed_by ? (names[ins.completed_by] ?? null) : null,
    photos,
  };
}
