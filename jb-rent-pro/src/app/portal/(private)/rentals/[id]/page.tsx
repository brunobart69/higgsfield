import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, FileSignature } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getPortalPayments, getPortalRentals } from "@/lib/portal/queries";
import { uuidSchema } from "@/lib/validation/common";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { RentalStatusBadge } from "@/components/rentals/rental-status-badge";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.portal.rentals.title };
}

export default async function PortalRentalPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }] = await Promise.all([getI18n(), params]);
  if (!uuidSchema.safeParse(id).success) notFound();
  const r = (await getPortalRentals()).find((x) => x.id === id);
  if (!r) notFound();
  const payments = await getPortalPayments(id);
  const p = t.portal.rentals;
  const canPdf = r.status !== "cancelled";
  return (
    <div className="space-y-6">
      <Link href="/portal" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {p.back}
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RentalStatusBadge status={r.status} returnAt={r.return_at} />
            <Badge variant={r.signature_status === "signed" ? "success" : "neutral"}>{r.signature_status === "signed" ? p.signed : p.unsigned}</Badge>
          </div>
          <h1 className="mt-1.5 font-mono text-2xl font-semibold tracking-tight">{r.contract_number}</h1>
          <p className="text-sm text-muted">
            {r.vehicle} · <span className="font-mono">{r.plate}</span>
          </p>
        </div>
        {canPdf && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a href={`/api/portal/contract/${r.id}?lang=${locale}`} target="_blank" rel="noopener noreferrer">
                <FileDown /> {p.contractPdf}
              </a>
            </Button>
          </div>
        )}
      </div>
      <Card>
        <CardContent className="p-5">
          <InfoGrid
            items={[
              { label: p.pickup, value: formatDateTime(r.pickup_at) },
              { label: p.return, value: formatDateTime(r.return_at) },
              { label: p.returned, value: r.actual_return_at && formatDateTime(r.actual_return_at) },
              { label: p.location, value: [r.pickup_location, r.return_location].filter(Boolean).join(" → ") },
              { label: p.total, value: formatCurrency(r.total_amount, locale) },
              { label: p.paid, value: formatCurrency(r.paid, locale) },
              { label: p.balance, value: <span className={r.balance > 0 && r.status !== "reservation" ? "text-warning" : undefined}>{formatCurrency(r.balance, locale)}</span> },
              {
                label: p.deposit,
                value:
                  r.deposit_amount > 0
                    ? `${formatCurrency(r.deposit_amount, locale)}${r.deposit_status ? ` · ${t.deposits.status[r.deposit_status]}` : ""}`
                    : "—",
              },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="size-4 text-gold" aria-hidden /> {p.payments}
          </CardTitle>
        </CardHeader>
        <CardContent className={payments.length ? "p-0" : undefined}>
          {payments.length === 0 ? (
            <p className="text-sm text-muted">{p.noPayments}</p>
          ) : (
            <ul className="divide-y divide-border">
              {payments.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    {x.kind === "refund" ? p.refund : t.rentals.payments?.kinds?.payment ?? p.paid} · {formatDate(x.paid_at)}
                    <span className="block text-xs text-muted">{t.paymentMethods[x.method as keyof typeof t.paymentMethods] ?? x.method}</span>
                  </span>
                  <span className={x.kind === "refund" ? "tabular text-danger" : "tabular"}>
                    {x.kind === "refund" ? "−" : ""}
                    {formatCurrency(x.amount, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
