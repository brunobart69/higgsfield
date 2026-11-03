import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // tudo, exceto arquivos estáticos, ícones, manifest e service worker
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)",
  ],
};
