import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/utils";

/**
 * Destino dos links enviados por e-mail (recuperação de senha, convite).
 * Suporta o fluxo token_hash (recomendado com SSR) e o fluxo PKCE (?code=).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeInternalPath(searchParams.get("next"), "/dashboard");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const fail = next.startsWith("/portal") ? "/portal/login?error=link" : "/login?error=link";
  return NextResponse.redirect(new URL(ok ? next : fail, origin));
}
