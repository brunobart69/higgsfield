"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { ActionForm, useFieldError } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n/provider";
import { interpolate } from "@/lib/i18n/config";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { toCents, centsToDecimalString } from "@/lib/money";
import { quote } from "@/lib/rentals/calc";
import { madridLocalToIso } from "@/lib/rentals/datetime";
import { MILEAGE_POLICIES, PAYMENT_METHODS, PRICING_MODES, type MileagePolicy, type PricingMode } from "@/lib/rentals/constants";
import type { FormState } from "@/lib/auth/validation";
import { checkConflictsAction } from "@/app/(app)/rentals/actions";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { cn } from "@/lib/utils";

type VehicleOpt = {
  id: string;
  brand: string;
  model: string;
  plate: string;
  status: string;
  daily_price: number | null;
  weekly_price: number | null;
  monthly_price: number | null;
};
type FeeOpt = { id: string; name_pt: string; name_es: string; amount: number; charge_type: "per_rental" | "per_day" };
type Extra = { key: string; fee_id: string | null; name: string; amount: string; charge_type: "per_rental" | "per_day"; quantity: number };

export type RentalFormValues = {
  id?: string;
  customer: PickedCustomer | null;
  vehicle_id: string;
  status?: "reservation" | "confirmed";
  pickup_date: string;
  pickup_time: string;
  return_date: string;
  return_time: string;
  pricing_mode: PricingMode;
  unit_price: string;
  discount_amount: string;
  extra_fees_amount: string;
  deposit_amount: string;
  payment_method: string;
  mileage_policy: MileagePolicy;
  mileage_limit_km: string;
  excess_km_price: string;
  contract_locale: "pt-BR" | "es-ES";
  pickup_location: string;
  return_location: string;
  notes: string;
  extras: Array<Omit<Extra, "key">>;
  lockedIdentity?: boolean; // em andamento: veículo, cliente e retirada fixos
};

const NOT_RENTABLE = ["maintenance", "unavailable", "sold"];
const money = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));
const safeCents = (v: string) => {
  try {
    return v.trim() ? toCents(v) : 0;
  } catch {
    return 0;
  }
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full font-display text-sm font-semibold text-gold-light">{title}</legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

function Fields({ v, vehicles, fees, graceMinutes, isNew }: { v: RentalFormValues; vehicles: VehicleOpt[]; fees: FeeOpt[]; graceMinutes: number; isNew: boolean }) {
  const { t, locale } = useI18n();
  const r = t.rentals;
  const f = r.fields;
  const err = useFieldError();
  const opt = t.common.optional;

  const [customer, setCustomer] = useState<PickedCustomer | null>(v.customer);
  const [vehicleId, setVehicleId] = useState(v.vehicle_id);
  const [pd, setPd] = useState(v.pickup_date);
  const [pt, setPt] = useState(v.pickup_time);
  const [rd, setRd] = useState(v.return_date);
  const [rt, setRt] = useState(v.return_time);
  const [mode, setMode] = useState<PricingMode>(v.pricing_mode);
  const [unit, setUnit] = useState(v.unit_price);
  const [unitTouched, setUnitTouched] = useState(!!v.id);
  const [discount, setDiscount] = useState(v.discount_amount);
  const [fees2, setFees2] = useState(v.extra_fees_amount);
  const [policy, setPolicy] = useState<MileagePolicy>(v.mileage_policy);
  const [limit, setLimit] = useState(v.mileage_limit_km);
  const [kmPrice, setKmPrice] = useState(v.excess_km_price);
  const [extras, setExtras] = useState<Extra[]>(v.extras.map((e, i) => ({ ...e, key: `e${i}` })));
  const [availability, setAvailability] = useState<{ state: "idle" | "checking" | "free" | "conflict"; items?: Array<{ contract_number: string; pickup_at: string; return_at: string }> }>({ state: "idle" });
  const seq = useRef(0);

  const vehicle = vehicles.find((x) => x.id === vehicleId) ?? null;
  const pickupIso = madridLocalToIso(pd, pt);
  const returnIso = madridLocalToIso(rd, rt);

  // preço sugerido pelo veículo e modalidade (até o usuário editar)
  useEffect(() => {
    if (unitTouched || !vehicle) return;
    const p = mode === "daily" ? vehicle.daily_price : mode === "weekly" ? vehicle.weekly_price : mode === "monthly" ? vehicle.monthly_price : null;
    if (p !== null) setUnit(money(p));
  }, [vehicle, mode, unitTouched]);

  // verificação de disponibilidade (a garantia final é a constraint do banco)
  useEffect(() => {
    if (!vehicleId || !pickupIso || !returnIso || returnIso <= pickupIso) {
      setAvailability({ state: "idle" });
      return;
    }
    const id = ++seq.current;
    setAvailability({ state: "checking" });
    const timer = setTimeout(async () => {
      const res = await checkConflictsAction(vehicleId, pickupIso, returnIso, v.id ?? null);
      if (id !== seq.current) return;
      if (!res.ok) setAvailability({ state: "idle" });
      else setAvailability(res.conflicts.length ? { state: "conflict", items: res.conflicts } : { state: "free" });
    }, 350);
    return () => clearTimeout(timer);
  }, [vehicleId, pickupIso, returnIso, v.id]);

  const q = useMemo(() => {
    if (!pickupIso || !returnIso || returnIso <= pickupIso) return null;
    return quote({
      pickupIso,
      returnIso,
      graceMinutes,
      mode,
      unitCents: safeCents(unit),
      discountCents: safeCents(discount),
      extraFeesCents: safeCents(fees2),
      extras: extras.map((e) => ({ amountCents: safeCents(e.amount), quantity: e.quantity, chargeType: e.charge_type })),
      policy,
      limitKm: limit ? Number(limit) : null,
      excessKmPriceCents: safeCents(kmPrice),
    });
  }, [pickupIso, returnIso, graceMinutes, mode, unit, discount, fees2, extras, policy, limit, kmPrice]);

  const licenceProblem = customer?.licence_expiry && rd && customer.licence_expiry < rd;
  const feeName = (fe: FeeOpt) => (locale === "es-ES" ? fe.name_es : fe.name_pt);
  const extrasPayload = JSON.stringify(
    extras.filter((e) => e.name.trim()).map((e) => ({
      fee_id: e.fee_id,
      name: e.name.trim(),
      amount: centsToDecimalString(safeCents(e.amount)),
      charge_type: e.charge_type,
      quantity: e.quantity,
    })),
  );

  function toggleFee(fe: FeeOpt, on: boolean) {
    setExtras((list) =>
      on
        ? [...list, { key: `f${fe.id}`, fee_id: fe.id, name: feeName(fe), amount: money(fe.amount), charge_type: fe.charge_type, quantity: 1 }]
        : list.filter((e) => e.fee_id !== fe.id),
    );
  }

  const rows: Array<[string, number, boolean?]> = q
    ? [
        [`${r.summary.base} (${q.days} ${t.common.days})`, q.baseCents],
        ...(q.extrasCents ? ([[r.summary.extras, q.extrasCents]] as Array<[string, number]>) : []),
        ...(safeCents(fees2) ? ([[r.summary.fees, safeCents(fees2)]] as Array<[string, number]>) : []),
        ...(safeCents(discount) ? ([[r.summary.discount, -safeCents(discount)]] as Array<[string, number]>) : []),
      ]
    : [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <input type="hidden" name="customer_id" value={customer?.id ?? ""} />
        <input type="hidden" name="extras" value={extrasPayload} />

        <Section title={r.sections.customer}>
          <CustomerPicker value={customer} onChange={setCustomer} error={err("customer_id")} disabled={v.lockedIdentity} />
          {licenceProblem && (
            <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {interpolate(r.licenceWarning, { date: formatDate(customer!.licence_expiry) })}
            </p>
          )}
        </Section>

        <Section title={r.sections.vehicle}>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle_id">{f.vehicle}</Label>
            <NativeSelect
              id="vehicle_id"
              name="vehicle_id"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={v.lockedIdentity}
              aria-invalid={err("vehicle_id") ? true : undefined}
            >
              <option value="">{r.pickVehicle}</option>
              {vehicles.map((x) => (
                <option key={x.id} value={x.id} disabled={NOT_RENTABLE.includes(x.status)}>
                  {x.plate} · {x.brand} {x.model}
                  {NOT_RENTABLE.includes(x.status) ? ` (${t.vehicles.status[x.status as keyof typeof t.vehicles.status]})` : ""}
                </option>
              ))}
            </NativeSelect>
            {v.lockedIdentity && <input type="hidden" name="vehicle_id" value={vehicleId} />}
            {err("vehicle_id") && (
              <p role="alert" className="text-xs text-danger">
                {err("vehicle_id")}
              </p>
            )}
          </div>
        </Section>

        <Section title={r.sections.period}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <TextField label={`${f.pickup} · ${f.date}`} name="pickup_date" type="date" value={pd} onChange={(e) => setPd(e.target.value)} readOnly={v.lockedIdentity} required error={err("pickup_date")} />
              <TextField label={f.time} name="pickup_time" type="time" step={900} value={pt} onChange={(e) => setPt(e.target.value)} readOnly={v.lockedIdentity} required />
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <TextField label={`${f.return} · ${f.date}`} name="return_date" type="date" value={rd} min={pd || undefined} onChange={(e) => setRd(e.target.value)} required error={err("return_date")} />
              <TextField label={f.time} name="return_time" type="time" step={900} value={rt} onChange={(e) => setRt(e.target.value)} required />
            </div>
            <TextField label={f.pickup_location} name="pickup_location" defaultValue={v.pickup_location} optionalLabel={opt} />
            <TextField label={f.return_location} name="return_location" defaultValue={v.return_location} optionalLabel={opt} />
          </div>
          {availability.state !== "idle" && (
            <div
              role="status"
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-xs",
                availability.state === "conflict" ? "border-danger/30 bg-danger/10 text-danger" : availability.state === "free" ? "border-success/30 bg-success/10 text-success" : "border-border text-muted",
              )}
            >
              {availability.state === "checking" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : availability.state === "free" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              <div>
                {availability.state === "checking" && r.availability.checking}
                {availability.state === "free" && r.availability.free}
                {availability.state === "conflict" && (
                  <>
                    <p>{interpolate(r.availability.conflict, { n: availability.items?.length ?? 0 })}</p>
                    <ul className="mt-1 space-y-0.5 tabular">
                      {availability.items?.map((c) => (
                        <li key={c.contract_number}>
                          {c.contract_number}: {formatDateTime(c.pickup_at)} → {formatDateTime(c.return_at)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}
        </Section>

        <Section title={r.sections.price}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label={f.pricing_mode}
              name="pricing_mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PricingMode)}
              options={PRICING_MODES.map((m) => ({ value: m, label: r.modes[m] }))}
              hint={r.modeHints[mode]}
              className="lg:col-span-2"
            />
            <TextField
              label={mode === "custom" ? f.unit_price_custom : f.unit_price}
              name="unit_price"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setUnitTouched(true);
              }}
              inputMode="decimal"
              required
              error={err("unit_price")}
            />
            <TextField label={f.discount_amount} name="discount_amount" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" error={err("discount_amount")} />
            <TextField label={f.extra_fees_amount} name="extra_fees_amount" value={fees2} onChange={(e) => setFees2(e.target.value)} inputMode="decimal" error={err("extra_fees_amount")} />
          </div>
        </Section>

        <Section title={r.sections.extras}>
          {fees.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {fees.map((fe) => {
                const on = extras.some((e) => e.fee_id === fe.id);
                return (
                  <label key={fe.id} className={cn("flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition", on ? "border-gold/50 bg-gold/5" : "border-border bg-surface-2")}>
                    <input type="checkbox" checked={on} onChange={(e) => toggleFee(fe, e.target.checked)} className="size-5 accent-[var(--gold)]" />
                    <span className="flex-1">{feeName(fe)}</span>
                    <span className="text-xs text-muted tabular">
                      {formatCurrency(fe.amount, locale)} {fe.charge_type === "per_day" ? t.vehicles.perDay : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {extras.length > 0 && (
            <ul className="space-y-2">
              {extras.map((e) => (
                <li key={e.key} className="grid grid-cols-[1fr_6rem_4.5rem_2.5rem] items-center gap-2 sm:grid-cols-[1fr_7rem_9rem_4.5rem_2.5rem]">
                  <Input aria-label={t.settings.fees.namePt} value={e.name} onChange={(ev) => setExtras((l) => l.map((x) => (x.key === e.key ? { ...x, name: ev.target.value } : x)))} className="h-10" />
                  <Input aria-label={t.settings.fees.amount} value={e.amount} inputMode="decimal" onChange={(ev) => setExtras((l) => l.map((x) => (x.key === e.key ? { ...x, amount: ev.target.value } : x)))} className="h-10" />
                  <NativeSelect
                    aria-label={t.settings.fees.chargeType}
                    value={e.charge_type}
                    onChange={(ev) => setExtras((l) => l.map((x) => (x.key === e.key ? { ...x, charge_type: ev.target.value as Extra["charge_type"] } : x)))}
                    className="hidden h-10 sm:flex"
                  >
                    <option value="per_rental">{t.settings.fees.perRental}</option>
                    <option value="per_day">{t.settings.fees.perDay}</option>
                  </NativeSelect>
                  <Input
                    aria-label="Qtd."
                    type="number"
                    min={1}
                    max={99}
                    value={e.quantity}
                    onChange={(ev) => setExtras((l) => l.map((x) => (x.key === e.key ? { ...x, quantity: Math.max(1, Math.min(99, Number(ev.target.value) || 1)) } : x)))}
                    className="h-10"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => setExtras((l) => l.filter((x) => x.key !== e.key))} aria-label={t.common.remove}>
                    <Trash2 className="text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {err("extras") && <p role="alert" className="text-xs text-danger">{err("extras")}</p>}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setExtras((l) => [...l, { key: `c${Date.now()}`, fee_id: null, name: "", amount: "", charge_type: "per_rental", quantity: 1 }])}
          >
            <Plus /> {t.common.add}
          </Button>
        </Section>

        <Section title={r.sections.mileage}>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label={f.mileage_policy}
              name="mileage_policy"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as MileagePolicy)}
              options={MILEAGE_POLICIES.map((p) => ({ value: p, label: t.settings.mileage[p] }))}
            />
            {policy !== "unlimited" && (
              <>
                <TextField label={f.mileage_limit_km} name="mileage_limit_km" value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" required error={err("mileage_limit_km")} />
                <TextField label={f.excess_km_price} name="excess_km_price" value={kmPrice} onChange={(e) => setKmPrice(e.target.value)} inputMode="decimal" error={err("excess_km_price")} />
              </>
            )}
          </div>
        </Section>

        <Section title={r.sections.deposit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label={f.deposit_amount} name="deposit_amount" defaultValue={v.deposit_amount} inputMode="decimal" error={err("deposit_amount")} />
            <SelectField
              label={f.payment_method}
              name="payment_method"
              defaultValue={v.payment_method}
              options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: t.paymentMethods[m] }))]}
            />
            <SelectField
              label={f.contract_locale}
              name="contract_locale"
              defaultValue={v.contract_locale}
              options={[
                { value: "es-ES", label: "Español (España)" },
                { value: "pt-BR", label: "Português (Brasil)" },
              ]}
            />
          </div>
        </Section>

        <Section title={r.sections.notes}>
          {isNew && (
            <SelectField
              label={f.status}
              name="status"
              defaultValue={v.status ?? "confirmed"}
              options={[
                { value: "confirmed", label: r.statusLabels.confirmed },
                { value: "reservation", label: r.statusLabels.reservation },
              ]}
            />
          )}
          <TextAreaField label={f.notes} name="notes" defaultValue={v.notes} rows={3} optionalLabel={opt} />
        </Section>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-lg border border-gold/25 bg-[linear-gradient(160deg,rgba(201,162,75,0.08),transparent_60%)] p-5">
          <p className="font-display text-sm font-semibold text-gold-light">{r.sections.summary}</p>
          {q ? (
            <dl className="mt-4 space-y-2 text-sm tabular">
              {vehicle && (
                <div className="flex justify-between gap-3 text-muted">
                  <dt className="truncate">{vehicle.brand} {vehicle.model}</dt>
                  <dd className="font-mono text-xs">{vehicle.plate}</dd>
                </div>
              )}
              {rows.map(([label, cents]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted">{label}</dt>
                  <dd>{formatCurrency(cents / 100, locale)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                <dt>{r.summary.total}</dt>
                <dd className="text-gold-light">{formatCurrency(q.totalCents / 100, locale)}</dd>
              </div>
              <div className="flex justify-between gap-3 text-xs text-muted">
                <dt>{r.summary.included}</dt>
                <dd>{q.allowedKm === null ? r.summary.unlimited : `${formatNumber(q.allowedKm, locale)} ${t.common.km}`}</dd>
              </div>
              {q.discountTooHigh && <p className="text-xs text-danger">{t.errors.discountTooHigh}</p>}
            </dl>
          ) : (
            <p className="mt-3 text-xs text-muted">—</p>
          )}
          <p className="mt-4 text-[0.68rem] leading-relaxed text-subtle">{r.summary.preview}</p>
        </div>
      </aside>
    </div>
  );
}

export function RentalForm({
  action,
  values,
  vehicles,
  fees,
  graceMinutes,
  isNew,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  values: RentalFormValues;
  vehicles: VehicleOpt[];
  fees: FeeOpt[];
  graceMinutes: number;
  isNew: boolean;
}) {
  const { t } = useI18n();
  return (
    <ActionForm action={action} className="space-y-6" successMessage={t.rentals.saved}>
      <Fields v={values} vehicles={vehicles} fees={fees} graceMinutes={graceMinutes} isNew={isNew} />
    </ActionForm>
  );
}
