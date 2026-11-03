import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Encerramento de sessão via POST (evita logout por link/GET de terceiros). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const form = await request.formData().catch(() => null);
  const next = form?.get("next") === "/portal/login" ? "/portal/login" : "/login";
  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}
