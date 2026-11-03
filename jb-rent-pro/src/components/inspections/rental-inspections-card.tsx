import Link from "next/link";
import { ClipboardCheck, GitCompare } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getRentalInspections, listDamages } from "@/lib/inspections/queries";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DamageList } from "./lists";
import { StartInspection } from "./start-inspection";

/** Inspeções de entrega/devolução do contrato, com atalhos para iniciar, continuar e comparar. */
export async function RentalInspectionsCard({ rentalId, vehicleId, status }: { rentalId: string; vehicleId: string; status: string }) {
  const [{ t }, pair, damages] = await Promise.all([getI18n(), getRentalInspections(rentalId), listDamages({ rentalId, limit: 20 })]);
  const it = t.inspections;
  const canDelivery = ["reservation", "confirmed", "in_progress", "late"].includes(status);
  const canReturn = ["in_progress", "late", "completed"].includes(status);
  const rows = [
    { type: "delivery" as const, insp: pair.delivery, can: canDelivery },
    { type: "return" as const, insp: pair.return, can: canReturn },
  ];
  const bothDone = pair.delivery?.status === "completed" && pair.return?.status === "completed";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-gold" /> {it.forRental}
        </CardTitle>
        {bothDone && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/inspections/compare/${rentalId}`}>
              <GitCompare /> {it.compare}
            </Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {rows.map(({ type, insp, can }) => (
            <li key={type} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{type === "delivery" ? it.newDelivery : it.newReturn}</p>
                <p className="text-xs text-muted">
                  {insp ? (
                    <>
                      <Badge variant={insp.status === "completed" ? "success" : "warning"}>{it.status[insp.status]}</Badge> {formatDateTime(insp.performed_at)}
                    </>
                  ) : (
                    it.missingInspection
                  )}
                </p>
              </div>
              {insp ? (
                <Button asChild size="sm" variant={insp.status === "completed" ? "ghost" : "default"}>
                  <Link href={`/inspections/${insp.id}`}>{insp.status === "completed" ? t.common.view : t.common.edit}</Link>
                </Button>
              ) : (
                can && <StartInspection vehicleId={vehicleId} rentalId={rentalId} type={type} label={t.common.new} size="sm" variant="secondary" />
              )}
            </li>
          ))}
        </ul>
        {damages.items.length > 0 && <DamageList items={damages.items} showVehicle={false} />}
      </CardContent>
    </Card>
  );
}
