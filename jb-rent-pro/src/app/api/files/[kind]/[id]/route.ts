import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/files/constants";

const SOURCES = {
  "vehicle-doc": { table: "documents", personal: false },
  "customer-doc": { table: "customer_documents", personal: true },
  photo: { table: "vehicle_photos", personal: false },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Abre um arquivo do bucket privado: confirma o acesso pela RLS (o registro
 * precisa ser visível ao usuário), gera um link válido por 60 s e redireciona.
 * Aberturas de documentos pessoais ficam no registro de atividades (RGPD).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const source = SOURCES[kind as keyof typeof SOURCES];
  if (!source || !UUID.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: row } = await supabase.from(source.table).select("storage_path").eq("id", id).maybeSingle();
  if (!row?.storage_path) return new NextResponse("Not found", { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60, download ? { download: true } : undefined);
  if (error || !data?.signedUrl) return new NextResponse("Not found", { status: 404 });

  if (source.personal) {
    await supabase.rpc("log_event", { p_action: "file.downloaded", p_entity: source.table, p_entity_id: id });
  }
  const res = NextResponse.redirect(data.signedUrl, { status: 302 });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
