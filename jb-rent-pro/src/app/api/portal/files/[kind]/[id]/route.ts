import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/files/constants";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Arquivo do próprio cliente (área do cliente): o banco confere a posse e
 * registra a abertura; o link temporário (60 s) é gerado com a sessão do
 * cliente, liberada pela política de Storage do portal.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!["customer-doc", "rental-doc"].includes(kind) || !UUID.test(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("portal_file_path", { p_kind: kind, p_id: id });
  if (error || !path) return new NextResponse("Not found", { status: 404 });
  const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(String(path), 60);
  if (signErr || !data?.signedUrl) return new NextResponse("Not found", { status: 404 });
  const res = NextResponse.redirect(data.signedUrl, { status: 302 });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  void request;
  return res;
}
