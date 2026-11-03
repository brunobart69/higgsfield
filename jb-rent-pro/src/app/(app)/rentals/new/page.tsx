import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getRentalFormOptions } from "@/lib/rentals/queries";
import { getCustomer, customerName } from "@/lib/customers/queries";
import { addDays, todayInMadrid } from "@/lib/periods";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { RentalForm, type RentalFormValues } from "@/components/rentals/rental-form";
import { createRentalAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.rentals.new };
}

const money = (n: number | null) => (n === null ? "" : n.toFixed(2).replace(".", ","));

export default async function NewRentalPage({ searchParams }: { searchParams: Promise<{ vehicle?: string; customer?: string; date?: string }> }) {
  const [{ t }, sp, opts] = await Promise.all([getI18n(), searchParams, getRentalFormOptions()]);
  const preCustomer = sp.customer ? await getCustomer(sp.customer) : null;
  const start = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : addDays(todayInMadrid(), 1);
  const values: RentalFormValues = {
    customer: preCustomer && !preCustomer.archived_at
      ? { id: preCustomer.id, name: customerName(preCustomer), detail: [preCustomer.id_document_number ?? preCustomer.tax_id, preCustomer.phone].filter(Boolean).join(" · "), licence_expiry: preCustomer.driving_licence_expiry }
      : null,
    vehicle_id: opts.vehicles.some((v) => v.id === sp.vehicle) ? sp.vehicle! : "",
    status: "confirmed",
    pickup_date: start,
    pickup_time: "10:00",
    return_date: addDays(start, 3),
    return_time: "10:00",
    pricing_mode: "daily",
    unit_price: "",
    discount_amount: "",
    extra_fees_amount: "",
    deposit_amount: money(opts.defaults.deposit_amount),
    payment_method: "",
    mileage_policy: opts.defaults.mileage_policy,
    mileage_limit_km: opts.defaults.mileage_limit_km ? String(opts.defaults.mileage_limit_km) : "",
    excess_km_price: money(opts.defaults.excess_km_price),
    contract_locale: opts.defaults.contract_locale,
    pickup_location: "",
    return_location: "",
    notes: "",
    extras: [],
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href="/rentals" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {t.rentals.title}
      </Link>
      <PageHeader eyebrow={t.nav.groups.operations} title={t.rentals.new} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <RentalForm action={createRentalAction} values={values} vehicles={opts.vehicles} fees={opts.fees} graceMinutes={opts.defaults.grace_minutes} isNew />
        </CardContent>
      </Card>
    </div>
  );
}
