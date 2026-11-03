import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { getInspection, getRentalInspections, listDamages } from "@/lib/inspections/queries";
import { getRental } from "@/lib/rentals/queries";
import { getCompanySettings } from "@/lib/settings/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale } from "@/lib/i18n/config";
import { buildComparisonPdf } from "@/lib/contracts/inspection-pdf";
import { loadLogo, toPdfInspection } from "@/lib/contracts/report-data";

export const runtime = "nodejs";

/** Relatório comparativo entrega × devolução de um contrato. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.status !== "ok") return NextResponse.redirect(new URL("/login", request.url));
  const { id } = await params;
  const [rental, pair, company, users] = await Promise.all([getRental(id), getRentalInspections(id), getCompanySettings(), listCompanyUsers()]);
  if (!rental || !company || pair.delivery?.status !== "completed" || pair.return?.status !== "completed") {
    return new NextResponse("Not found", { status: 404 });
  }
  const [del, ret, damages] = await Promise.all([getInspection(pair.delivery.id), getInspection(pair.return.id), listDamages({ rentalId: id, limit: 50 })]);
  if (!del || !ret) return new NextResponse("Not found", { status: 404 });
  const lang = request.nextUrl.searchParams.get("lang");
  const locale = isLocale(lang) ? lang : rental.contract_locale;
  const supabase = await createClient();
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const c = rental.customer;
  try {
    const pdf = await buildComparisonPdf({
      delivery: await toPdfInspection(supabase, del, names),
      ret: await toPdfInspection(supabase, ret, names),
      vehicle: rental.vehicle,
      contractNumber: rental.contract_number,
      customer: (c.customer_type === "company" ? c.company_name : c.full_name) ?? null,
      damages: damages.items,
      company,
      logo: await loadLogo(supabase, company),
      t: getDictionary(locale),
      locale,
    });
    await supabase.rpc("log_event", { p_action: "report.generated", p_entity: "rentals", p_entity_id: id, p_details: { report: "inspection_comparison" } });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${rental.contract_number}-inspecciones-${locale}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[comparison] pdf failed", err);
    return new NextResponse("PDF error", { status: 500 });
  }
}
