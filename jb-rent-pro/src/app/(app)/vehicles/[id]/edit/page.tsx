import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getVehicle } from "@/lib/vehicles/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { updateVehicleAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.vehicles.edit };
}

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const v = await getVehicle(id);
  if (!v) notFound();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href={`/vehicles/${id}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {v.brand} {v.model} · {v.plate}
      </Link>
      <PageHeader eyebrow={t.nav.groups.fleet} title={t.vehicles.edit} description={`${v.brand} ${v.model} · ${v.plate}`} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <VehicleForm action={updateVehicleAction.bind(null, id)} values={v} />
        </CardContent>
      </Card>
    </div>
  );
}
