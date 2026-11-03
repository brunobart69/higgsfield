import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { getRental } from "@/lib/rentals/queries";
import { getCompanySettings } from "@/lib/settings/queries";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale } from "@/lib/i18n/config";
import { buildContractPdf } from "@/lib/contracts/pdf";
import { BUCKET } from "@/lib/files/constants";

export const runtime = "nodejs";

/** Contrato em PDF no idioma pedido (?lang=pt-BR|es-ES); padrão = idioma do contrato. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.status !== "ok") return NextResponse.redirect(new URL("/login", request.url));
  const { id } = await params;
  const rental = await getRental(id);
  if (!rental) return new NextResponse("Not found", { status: 404 });
  const company = await getCompanySettings();
  if (!company) return new NextResponse("Not found", { status: 404 });

  const requested = request.nextUrl.searchParams.get("lang");
  const locale = isLocale(requested) ? requested : rental.contract_locale;

  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (company.logo_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from(BUCKET).download(company.logo_path);
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
    console.error("[contract] pdf failed", err);
    return new NextResponse("PDF error", { status: 500 });
  }
}
