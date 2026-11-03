import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getRental, getRentalFormOptions } from "@/lib/rentals/queries";
import { isoToMadridLocal } from "@/lib/rentals/datetime";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { RentalForm, type RentalFormValues } from "@/components/rentals/rental-form";
import { updateRentalAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.rentals.edit };
}

const money = (n: number | null) => (n === null || n === 0 ? "" : n.toFixed(2).replace(".", ","));

export default async function EditRentalPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ t }, { id }] = await Promise.all([getI18n(), params]);
  const [r, opts] = await Promise.all([getRental(id), getRentalFormOptions()]);
  if (!r) notFound();
  if (r.status === "completed" || r.status === "cancelled") redirect(`/rentals/${id}`);
  const p = isoToMadridLocal(r.pickup_at);
  const ret = isoToMadridLocal(r.return_at);
  const c = r.customer;
  const values: RentalFormValues = {
    id: r.id,
    customer: { id: c.id, name: (c.customer_type === "company" ? c.company_name : c.full_name) ?? "—", detail: [c.id_document_number ?? c.tax_id, c.phone].filter(Boolean).join(" · "), licence_expiry: c.driving_licence_expiry },
    vehicle_id: r.vehicle_id,
    pickup_date: p.date,
    pickup_time: p.time,
    return_date: ret.date,
    return_time: ret.time,
    pricing_mode: r.pricing_mode,
    unit_price: r.unit_price.toFixed(2).replace(".", ","),
    discount_amount: money(r.discount_amount),
    extra_fees_amount: money(r.extra_fees_amount),
    deposit_amount: money(r.deposit_amount),
    payment_method: r.payment_method ?? "",
    mileage_policy: r.mileage_policy,
    mileage_limit_km: r.mileage_limit_km ? String(r.mileage_limit_km) : "",
    excess_km_price: money(r.excess_km_price),
    contract_locale: r.contract_locale,
    pickup_location: r.pickup_location ?? "",
    return_location: r.return_location ?? "",
    notes: r.notes ?? "",
    extras: r.extras.map((e) => ({ fee_id: e.fee_id, name: e.name, amount: e.amount.toFixed(2).replace(".", ","), charge_type: e.charge_type, quantity: e.quantity })),
    lockedIdentity: r.status === "in_progress" || r.status === "late",
  };
  // veículo atual sempre presente na lista, mesmo que esteja "alugado"
  const vehicles = opts.vehicles.some((v) => v.id === r.vehicle_id)
    ? opts.vehicles
    : [...opts.vehicles, { ...r.vehicle, status: "rented", weekly_price: null, monthly_price: null }];
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href={`/rentals/${id}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="size-4" /> {r.contract_number}
      </Link>
      <PageHeader eyebrow={t.nav.groups.operations} title={t.rentals.edit} description={r.contract_number} />
      <Card>
        <CardContent className="p-5 sm:p-6">
          <RentalForm action={updateRentalAction.bind(null, id)} values={values} vehicles={vehicles} fees={opts.fees} graceMinutes={opts.defaults.grace_minutes} isNew={false} />
        </CardContent>
      </Card>
    </div>
  );
}
