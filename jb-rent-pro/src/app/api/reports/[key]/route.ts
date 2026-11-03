import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { buildReport } from "@/lib/reports/definitions";
import { isReportKey, parseReportParams } from "@/lib/reports/params";
import { toCsv } from "@/lib/reports/csv";
import { buildReportPdf } from "@/lib/reports/pdf";
import { formatDateTime } from "@/lib/format";

export const runtime = "nodejs";

/** Exportação de relatórios (CSV ou PDF). Somente equipe; cada exportação fica registrada. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession();
  if (session.status !== "ok") return NextResponse.redirect(new URL("/login", request.url));
  const { key } = await params;
  if (!isReportKey(key)) return new NextResponse("Not found", { status: 404 });
  const sp = request.nextUrl.searchParams;
  const format = sp.get("format") === "pdf" ? "pdf" : "csv";
  const { period, basis } = parseReportParams({ period: sp.get("period"), from: sp.get("from"), to: sp.get("to"), basis: sp.get("basis") });
  const { t, locale } = await getI18n();
  const doc = await buildReport(key, { from: period.from, to: period.to, basis }, t);

  const supabase = await createClient();
  await supabase.rpc("log_event", {
    p_action: "report.generated",
    p_entity: "reports",
    p_entity_id: key,
    p_details: { report: key, format, from: period.from, to: period.to, basis },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `jbrent-${key}-${period.from}_${period.to}-${stamp}`;
  if (format === "csv") {
    return new NextResponse(toCsv(doc), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  try {
    const pdf = await buildReportPdf(doc, {
      company: session.profile.companyName,
      generatedLabel: interpolate(t.reports.generated, { date: formatDateTime(new Date()), user: session.profile.fullName ?? session.profile.email }),
      pageLabel: (n, total) => interpolate(t.reports.page, { n, total }),
      locale,
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[reports] pdf failed", err);
    return new NextResponse("PDF error", { status: 500 });
  }
}
