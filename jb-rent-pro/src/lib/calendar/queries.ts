import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CalEvent } from "./grid";

export async function getCalendarEvents(from: string, to: string): Promise<CalEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calendar_events", { p_from: from, p_to: to });
  if (error) console.error("[calendar] events failed", error.code, error.message);
  return (data ?? []) as CalEvent[];
}

export type AvailableVehicle = {
  vehicle_id: string;
  label: string;
  plate: string;
  category: string | null;
  daily_price: number | null;
  status: string;
  available: boolean;
  conflict_contract: string | null;
  maintenance_conflict: boolean;
  insured: boolean;
};

export async function getAvailableVehicles(fromIso: string, toIso: string): Promise<AvailableVehicle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("available_vehicles", { p_from: fromIso, p_to: toIso });
  if (error) console.error("[calendar] availability failed", error.code, error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as AvailableVehicle),
    daily_price: r.daily_price === null ? null : Number(r.daily_price),
  }));
}

/** Veículos da frota (linha do tempo), em ordem de matrícula. */
export async function getFleetRows() {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles").select("id, brand, model, plate, status").is("archived_at", null).neq("status", "sold").order("plate");
  return (data ?? []) as Array<{ id: string; brand: string; model: string; plate: string; status: string }>;
}
