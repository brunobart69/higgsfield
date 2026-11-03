import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, GitCompare } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/session";
import { getInspection, listDamages } from "@/lib/inspections/queries";
import { listCompanyUsers } from "@/lib/users/queries";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoGrid } from "@/components/ui/info-grid";
import { InspectionEditor } from "@/components/inspections/inspection-editor";
import { InspectionView } from "@/components/inspections/inspection-view";
import { DamageDialog } from "@/components/inspections/damage-dialog";
import { DamageList } from "@/components/inspections/lists";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.inspections.title };
}

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t, locale }, { id }, session] = await Promise.all([getI18n(), params, getSession()]);
  const insp = await getInspection(id);
  if (!insp || session.status !== "ok") notFound();
  const it = t.inspections;
  const [open, found, users] = await Promise.all([
    listDamages({ vehicleId: insp.vehicle_id, openOnly: true, limit: 50 }),
    listDamages({ vehicleId: insp.vehicle_id, limit: 50 }),
    listCompanyUsers(),
  ]);
  const names = users.ok ? Object.fromEntries(users.users.map((u) => [u.id, u.fullName ?? u.email])) : {};
  // avarias ligadas ao contrato da inspeção (ou ao veículo, em inspeções periódicas)
  const fromThis = insp.rental_id ? found.items.filter((d) => d.rental_id === insp.rental_id) : found.items;
  const completed = insp.status === "completed";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={insp.rental ? `/rentals/${insp.rental.id}` : `/vehicles/${insp.vehicle_id}?tab=inspections`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {insp.rental ? insp.rental.contract_number : `${insp.vehicle.brand} ${insp.vehicle.model}`}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={completed ? "success" : "warning"}>{it.status[insp.status]}</Badge>
            <span className="font-mono text-xs">{insp.vehicle.plate}</span>
          </div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {it.types[insp.inspection_type]} · {insp.vehicle.brand} {insp.vehicle.model}
          </h1>
          {insp.rental && (
            <p className="text-sm text-muted">
              {insp.rental.contract_number}
              {insp.rental.customer ? ` · ${insp.rental.customer}` : ""}
            </p>
          )}
        </div>
        {completed && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <a href={`/api/inspections/${insp.id}/report?lang=${locale}`} target="_blank" rel="noopener noreferrer">
                <FileDown /> {it.report}
              </a>
            </Button>
            {insp.inspection_type === "return" && insp.rental && (
              <Button asChild>
                <Link href={`/inspections/compare/${insp.rental.id}`}>
                  <GitCompare /> {it.compare}
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {completed ? (
        <>
          <Card>
            <CardContent className="p-5">
              <InfoGrid
                items={[
                  { label: it.fields.mileage, value: insp.mileage !== null && formatNumber(insp.mileage, locale) },
                  { label: it.fields.fuel, value: insp.fuel_level !== null && `${insp.fuel_level} %` },
                  { label: it.fields.performedAt, value: formatDateTime(insp.completed_at ?? insp.performed_at) },
                  { label: it.inspector, value: insp.completed_by ? names[insp.completed_by] : null },
                  { label: it.fields.customerName, value: insp.customer_present ? insp.customer_name : t.common.no },
                  { label: it.fields.existingConfirmed, value: insp.existing_damages_confirmed ? t.common.yes : t.common.no },
                  { label: it.fields.observations, value: insp.observations, wide: true },
                ]}
              />
            </CardContent>
          </Card>
          <InspectionView inspection={insp} />
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle>{t.damages.title}</CardTitle>
              <DamageDialog
                size="sm"
                label={it.registerDamage}
                values={{ vehicle_id: insp.vehicle_id, rental_id: insp.rental_id, inspection_id: insp.id, mileage: insp.mileage }}
              />
            </CardHeader>
            <CardContent>
              {fromThis.length === 0 ? <p className="text-sm text-muted">{t.damages.empty}</p> : <DamageList items={fromThis} showVehicle={false} />}
            </CardContent>
          </Card>
        </>
      ) : (
        <InspectionEditor inspection={insp} companyId={session.profile.companyId} openDamages={open.items} />
      )}
    </div>
  );
}
