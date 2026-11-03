"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/guards";
import type { FormState } from "@/lib/auth/validation";
import { mapDbError } from "@/lib/db-errors";
import { uuidSchema } from "@/lib/validation/common";

export async function markNotificationsReadAction(ids: string[] | null): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  if (ids && (!ids.length || ids.length > 200 || !ids.every((i) => uuidSchema.safeParse(i).success))) return { error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids });
  if (error) return { error: mapDbError(error) };
  revalidatePath("/", "layout");
  return { ok: true };
}

const statusSchema = z.enum(["contacted", "converted", "declined"]);

export async function updateRequestAction(id: string, status: string): Promise<FormState> {
  const guard = await requireStaff();
  if (!guard.ok) return { error: guard.error };
  const s = statusSchema.safeParse(status);
  if (!uuidSchema.safeParse(id).success || !s.success) return { error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("rental_requests").update({ status: s.data }).eq("id", id).select("id");
  if (error) return { error: mapDbError(error) };
  if (!data?.[0]) return { error: "notFound" };
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { ok: true };
}
