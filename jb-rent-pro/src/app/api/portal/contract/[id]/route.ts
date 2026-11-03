import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getRental } from "@/lib/rentals/queries";
import { getCompanySettings } from "@/lib/settings/queries";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale } from "@/lib/i18n/config";
import { buildContractPdf } from "@/lib/contracts/pdf";
import { BUCKET } from "@/lib/files/constants";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Contrato em PDF para o cliente do portal. A posse é verificada pelo banco
 * com a sessão do cliente; só então os dados são lidos com a chave de serviço
 * (somente leitura, deste contrato e da empresa dele).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: owns } = await supabase.rpc("portal_owns_rental", { p_rental: id });
  if (owns !== true) return new NextResponse("Not found", { status: 404 });
  if (!isAdminConfigured()) return new NextResponse("Service unavailable", { status: 503 });

  const admin = createAdminClient();
  const rental = await getRental(id, admin as unknown as Awaited<ReturnType<typeof createClient>>);
  if (!rental) return new NextResponse("Not found", { status: 404 });
  const { data: row } = await admin.from("rentals").select("company_id").eq("id", id).single();
  const company = row ? await getCompanySettings({ client: admin as unknown as Awaited<ReturnType<typeof createClient>>, companyId: row.company_id }) : null;
  if (!company) return new NextResponse("Not found", { status: 404 });

  const requested = request.nextUrl.searchParams.get("lang");
  const locale = isLocale(requested) ? requested : rental.contract_locale;
  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (company.logo_path) {
    const { data } = await admin.storage.from(BUCKET).download(company.logo_path);
    if (data) logo = { bytes: new Uint8Array(await data.arrayBuffer()), type: company.logo_path.endsWith(".png") ? "png" : "jpg" };
  }
  try {
    const pdf = await buildContractPdf({ rental, company, logo, t: getDictionary(locale), locale });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${rental.contract_number}-${locale}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[portal] contract pdf failed", err);
    return new NextResponse("PDF error", { status: 500 });
  }
}
