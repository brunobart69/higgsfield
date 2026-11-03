"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toFieldErrors, type FormState } from "@/lib/auth/validation";
import { madridLocalToIso } from "@/lib/rentals/datetime";

const schema = z
  .object({
    pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
    pickup_time: z.string().regex(/^\d{2}:\d{2}$/, "invalidDate"),
    return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalidDate"),
    return_time: z.string().regex(/^\d{2}:\d{2}$/, "invalidDate"),
    preference: z.string().trim().max(160, "tooLong").optional(),
    notes: z.string().trim().max(1000, "tooLong").optional(),
  })
  .superRefine((v, ctx) => {
    const a = madridLocalToIso(v.pickup_date, v.pickup_time);
    const b = madridLocalToIso(v.return_date, v.return_time);
    if (!a) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["pickup_date"] });
    if (!b) ctx.addIssue({ code: "custom", message: "invalidDate", path: ["return_date"] });
    if (a && b && b <= a) ctx.addIssue({ code: "custom", message: "returnBeforePickup", path: ["return_date"] });
  });

export async function requestRentalAction(_p: FormState, fd: FormData): Promise<FormState> {
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: toFieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_request_rental", {
    p_pickup: madridLocalToIso(v.pickup_date, v.pickup_time),
    p_return: madridLocalToIso(v.return_date, v.return_time),
    p_preference: v.preference ?? null,
    p_notes: v.notes ?? null,
  });
  if (error) {
    if (error.message?.includes("INVALID_PERIOD")) return { error: "invalidPeriod" };
    if (error.message?.includes("TOO_MANY_REQUESTS")) return { error: "tooManyRequests" };
    if (error.message?.includes("PORTAL_FORBIDDEN")) return { error: "portalForbidden" };
    return { error: "generic" };
  }
  revalidatePath("/portal/request");
  return { ok: true };
}
