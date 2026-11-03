import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getDefaultPrices } from "@/lib/vehicles/queries";
import { todayInMadrid } from "@/lib/periods";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { createVehicleAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.vehicles.new };
}

export default async function NewVehiclePage() {
  const [{ t }, prices] = await Promise.all([getI18n(), getDefaultPrices()]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/vehicles" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {t.vehicles.title}
      </Link>
      <PageHeader eyebrow={t.nav.groups.fleet} title={t.vehicles.new} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <VehicleForm action={createVehicleAction} isNew values={{ ...prices, status: "available", fleet_entry_date: todayInMadrid() }} />
        </CardContent>
      </Card>
    </div>
  );
}
