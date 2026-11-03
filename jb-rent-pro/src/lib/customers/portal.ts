import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function getPortalAccount(customerId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_portal_accounts")
    .select("invited_at, last_seen_at, disabled_at, email")
    .eq("customer_id", customerId)
    .maybeSingle();
  return (data as { invited_at: string; last_seen_at: string | null; disabled_at: string | null; email: string } | null) ?? null;
}
