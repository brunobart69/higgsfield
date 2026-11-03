import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { getInspection, listDamages } from "@/lib/inspections/queries";
import { getCompanySettings } from "@/lib/settings/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale } from "@/lib/i18n/config";
import { buildInspectionPdf } from "@/lib/contracts/inspection-pdf";
import { loadLogo, toPdfInspection } from "@/lib/contracts/report-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.status !== "ok") return NextResponse.redirect(new URL("/login", request.url));
  const { id } = await params;
  const [ins, company, users] = await Promise.all([getInspection(id), getCompanySettings(), listCompanyUsers()]);
  if (!ins || !company || ins.status !== "completed") return new NextResponse("Not found", { status: 404 });
  const lang = request.nextUrl.searchParams.get("lang");
  const locale = isLocale(lang) ? lang : company.default_locale;
  const supabase = await createClient();
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  const damages = await listDamages({ vehicleId: ins.vehicle_id, rentalId: ins.rental_id ?? undefined, limit: 50 });
  try {
    const pdf = await buildInspectionPdf({
      inspection: await toPdfInspection(supabase, ins, names),
      vehicle: ins.vehicle,
      contractNumber: ins.rental?.contract_number ?? null,
      customer: ins.rental?.customer ?? null,
      damages: damages.items,
      company,
      logo: await loadLogo(supabase, company),
      t: getDictionary(locale),
      locale,
    });
    await supabase.rpc("log_event", { p_action: "report.generated", p_entity: "inspections", p_entity_id: id });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="inspeccion-${ins.vehicle.plate.replace(/\s/g, "")}-${ins.inspection_type}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[inspection] pdf failed", err);
    return new NextResponse("PDF error", { status: 500 });
  }
}
