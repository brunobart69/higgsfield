import type { Metadata } from "next";
import { Eye, FileText, Info } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getPortalDocuments } from "@/lib/portal/queries";
import { formatDate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.portal.documents.title };
}

export default async function PortalDocuments() {
  const [{ t }, docs] = await Promise.all([getI18n(), getPortalDocuments()]);
  const d = t.portal.documents;
  const today = new Date().toISOString().slice(0, 10);
  const label = (x: (typeof docs)[number]) =>
    x.kind === "customer-doc"
      ? (t.customers.docs.types[x.category as keyof typeof t.customers.docs.types] ?? x.category)
      : (t.docsCenter.categories[x.category as keyof typeof t.docsCenter.categories] ?? x.category);
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight">{d.title}</h1>
      <p className="flex items-start gap-2 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {d.hint}
      </p>
      {docs.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">{d.empty}</Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {docs.map((x) => (
            <a
              key={`${x.kind}-${x.id}`}
              href={`/api/portal/files/${x.kind}/${x.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2/60 sm:px-5"
            >
              <FileText className="size-5 shrink-0 text-gold" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{x.title}</span>
                  {x.expires_at && x.expires_at < today && <Badge variant="danger">{t.vehicles.docs.expired}</Badge>}
                </div>
                <p className="truncate text-xs text-muted">
                  {label(x)}
                  {x.contract_number && ` · ${interpolate(d.contract, { n: x.contract_number })}`}
                  {x.expires_at && ` · ${t.vehicles.docs.expires}: ${formatDate(x.expires_at)}`}
                  {` · ${formatDate(x.created_at)}`}
                </p>
              </div>
              <Eye className="size-4 text-muted" aria-label={d.open} />
            </a>
          ))}
        </Card>
      )}
    </div>
  );
}
