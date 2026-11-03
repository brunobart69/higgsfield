import type { Metadata } from "next";
import Link from "next/link";
import { CalendarSearch, ChevronLeft, ChevronRight, ShieldAlert, Wrench } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { getAvailableVehicles, getCalendarEvents, getFleetRows } from "@/lib/calendar/queries";
import { barSpan, dayItems, hrefFor, monthMatrix, type CalEvent, type DayItem } from "@/lib/calendar/grid";
import { addDays, addMonths, isIsoDate, todayInMadrid } from "@/lib/periods";
import { madridLocalToIso } from "@/lib/rentals/datetime";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.calendar.title };
}

type SP = { view?: string; date?: string; af?: string; at?: string; bf?: string; bt?: string };

/** Cor por tipo/situação (tokens do tema). */
const TONE: Record<string, string> = {
  reservation: "border-info/40 bg-info/15 text-info",
  confirmed: "border-gold/50 bg-gold/15 text-gold-light",
  in_progress: "border-success/40 bg-success/15 text-success",
  late: "border-danger/50 bg-danger/15 text-danger",
  completed: "border-border bg-surface-3 text-muted",
  maintenance: "border-warning/40 bg-warning/15 text-warning",
  deadline: "border-danger/40 bg-danger/10 text-danger",
  info: "border-border bg-surface-2 text-muted",
};

function itemTone(i: DayItem) {
  if (i.type === "pickup" || i.type === "return") return TONE[i.event.status] ?? TONE.info;
  if (i.type === "maintenance") return TONE.maintenance;
  if (i.type === "insurance_end" && i.event.status === "renewed") return TONE.info;
  return TONE.deadline;
}

const MAX_PER_DAY = 3;

function weekdayNames(locale: Locale) {
  const f = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i)))); // 2024-01-01 = segunda
}

function ItemChip({ i, t, compact = false }: { i: DayItem; t: Dictionary; compact?: boolean }) {
  return (
    <Link
      href={hrefFor(i.event)}
      className={cn("block truncate rounded border px-1.5 py-0.5 text-[11px] leading-4 transition hover:brightness-125", itemTone(i))}
      title={`${t.calendar.kinds[i.type]} · ${i.event.title} · ${i.event.plate}${i.event.subtitle && i.event.kind !== "fine_deadline" ? ` · ${i.event.subtitle}` : ""}`}
    >
      {i.time && <span className="tabular">{i.time} </span>}
      <span className="font-medium">{compact ? i.event.plate : t.calendar.kinds[i.type]}</span>
      {!compact && <span className="opacity-80"> · {i.event.plate}</span>}
    </Link>
  );
}

function MonthView({ ym, events, t, locale, today }: { ym: string; events: CalEvent[]; t: Dictionary; locale: Locale; today: string }) {
  const weeks = monthMatrix(ym);
  const items = dayItems(events);
  const names = weekdayNames(locale);
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const monthDays = weeks.flat().filter((d) => d.slice(0, 7) === ym && (items.get(d)?.length ?? 0) > 0);
  return (
    <>
      {/* grade (tablet/desktop) */}
      <Card className="hidden overflow-hidden md:block">
        <div className="grid grid-cols-7 border-b border-border text-center text-xs text-subtle">
          {names.map((n) => (
            <div key={n} className="py-2 capitalize">
              {n}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((d) => {
            const list = items.get(d) ?? [];
            const out = d.slice(0, 7) !== ym;
            return (
              <div key={d} className={cn("group min-h-28 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0", out && "bg-surface-2/40")}>
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular",
                      d === today ? "bg-gold text-gold-foreground font-semibold" : out ? "text-subtle" : "text-muted",
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {!out && d >= today && (
                    <Link href={`/rentals/new?date=${d}`} className="px-1 text-sm leading-none text-subtle opacity-0 transition hover:text-gold-light focus:opacity-100 group-hover:opacity-100" aria-label={`+ ${d}`}>
                      +
                    </Link>
                  )}
                </div>
                <div className="space-y-0.5">
                  {list.slice(0, MAX_PER_DAY).map((i) => (
                    <ItemChip key={i.key} i={i} t={t} />
                  ))}
                  {list.length > MAX_PER_DAY && (
                    <Link href={`/calendar?view=fleet&date=${d}`} className="block px-1 text-[11px] text-subtle hover:text-foreground">
                      {interpolate(t.calendar.more, { n: list.length - MAX_PER_DAY })}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {/* agenda (celular) */}
      <div className="space-y-3 md:hidden">
        {monthDays.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">{t.calendar.noEvents}</Card>
        ) : (
          monthDays.map((d) => (
            <Card key={d} className={cn("p-3", d === today && "border-gold/40")}>
              <p className="mb-2 text-xs font-medium capitalize text-gold-light">{dayFmt.format(new Date(`${d}T00:00:00Z`))}</p>
              <div className="space-y-1">
                {(items.get(d) ?? []).map((i) => (
                  <Link key={i.key} href={hrefFor(i.event)} className={cn("flex items-center gap-2 rounded border px-2 py-1.5 text-xs", itemTone(i))}>
                    {i.time && <span className="tabular">{i.time}</span>}
                    <span className="font-medium">{t.calendar.kinds[i.type]}</span>
                    <span className="min-w-0 flex-1 truncate opacity-80">
                      {i.event.plate} · {i.event.title}
                      {i.event.kind === "rental" && i.event.subtitle ? ` · ${i.event.subtitle}` : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}

const FLEET_DAYS = 14;

function FleetView({ start, events, vehicles, t, locale, today }: { start: string; events: CalEvent[]; vehicles: Awaited<ReturnType<typeof getFleetRows>>; t: Dictionary; locale: Locale; today: string }) {
  const days = Array.from({ length: FLEET_DAYS }, (_, i) => addDays(start, i));
  const dfmt = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
  const cols = { gridTemplateColumns: `repeat(${FLEET_DAYS}, minmax(2.6rem, 1fr))` };
  return (
    <Card className="overflow-hidden">
      <div className="scrollbar-thin overflow-x-auto">
        <div className="min-w-[48rem]">
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-10 w-36 shrink-0 bg-surface px-3 py-2 text-xs text-subtle sm:w-44" />
            <div className="grid flex-1" style={cols}>
              {days.map((d) => (
                <div key={d} className={cn("py-1.5 text-center text-[11px] leading-tight tabular", d === today ? "text-gold-light" : "text-subtle")}>
                  <span className="block uppercase">{dfmt.format(new Date(`${d}T00:00:00Z`))}</span>
                  <span className={cn("font-medium", d === today && "rounded bg-gold/20 px-1")}>{Number(d.slice(8))}</span>
                </div>
              ))}
            </div>
          </div>
          {vehicles.map((v) => {
            const mine = events.filter((e) => e.vehicle_id === v.id && (e.kind === "rental" || e.kind === "maintenance"));
            const marks = events.filter((e) => e.vehicle_id === v.id && e.kind !== "rental" && e.kind !== "maintenance");
            return (
              <div key={v.id} className="flex border-b border-border last:border-b-0">
                <Link href={`/vehicles/${v.id}`} className="sticky left-0 z-10 w-36 shrink-0 bg-surface px-3 py-2 hover:bg-surface-2 sm:w-44">
                  <span className="block truncate text-sm font-medium">
                    {v.brand} {v.model}
                  </span>
                  <span className="font-mono text-[11px] text-muted">{v.plate}</span>
                </Link>
                <div className="relative grid flex-1" style={cols}>
                  {days.map((d, i) => (
                    <Link
                      key={d}
                      href={`/rentals/new?vehicle=${v.id}&date=${d}`}
                      style={{ gridColumn: i + 1, gridRow: 1 }}
                      className={cn("min-h-12 border-l border-border/60 transition hover:bg-gold/5", d === today && "bg-gold/[0.04]", d < today && "pointer-events-none")}
                      aria-label={`${t.calendar.free} · ${v.plate} · ${d}`}
                    />
                  ))}
                  {mine.map((e) => {
                    const span = barSpan(e, start, FLEET_DAYS);
                    if (!span) return null;
                    const tone = e.kind === "maintenance" ? TONE.maintenance : (TONE[e.status] ?? TONE.info);
                    return (
                      <Link
                        key={e.id}
                        href={hrefFor(e)}
                        style={{ gridColumn: `${span.from + 1} / ${span.to + 2}`, gridRow: 1 }}
                        className={cn("z-[1] mx-0.5 my-2 flex items-center gap-1 truncate rounded-md border px-1.5 text-[11px] font-medium", tone)}
                        title={`${e.title}${e.subtitle ? ` · ${e.subtitle}` : ""}`}
                      >
                        {e.kind === "maintenance" && <Wrench className="size-3 shrink-0" aria-hidden />}
                        <span className="truncate">{e.kind === "rental" ? e.subtitle || e.title : e.title}</span>
                      </Link>
                    );
                  })}
                  {marks.map((e) => {
                    const span = barSpan(e, start, FLEET_DAYS);
                    if (!span) return null;
                    return (
                      <Link
                        key={`${e.kind}-${e.id}`}
                        href={hrefFor(e)}
                        style={{ gridColumn: span.from + 1, gridRow: 1 }}
                        className="z-[2] self-start justify-self-end p-0.5"
                        title={`${e.kind === "fine_deadline" ? t.calendar.kinds[e.subtitle === "identification" ? "fine_identification" : "fine_payment"] : t.calendar.kinds[e.kind as "itv" | "insurance_end"]} · ${e.title}`}
                      >
                        <ShieldAlert className="size-3.5 text-danger" aria-hidden />
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

async function Availability({ sp, t, locale, view, anchor }: { sp: SP; t: Dictionary; locale: Locale; view: string; anchor: string }) {
  const a = t.calendar.availability;
  const today = todayInMadrid();
  const af = isIsoDate(sp.af) ? sp.af : addDays(today, 1);
  const at = sp.at && /^\d{2}:\d{2}$/.test(sp.at) ? sp.at : "10:00";
  const bf = isIsoDate(sp.bf) && sp.bf >= af ? sp.bf : addDays(af, 3);
  const bt = sp.bt && /^\d{2}:\d{2}$/.test(sp.bt) ? sp.bt : "10:00";
  const searched = !!sp.af;
  const fromIso = madridLocalToIso(af, at);
  const toIso = madridLocalToIso(bf, bt);
  const rows = searched && fromIso && toIso && toIso > fromIso ? await getAvailableVehicles(fromIso, toIso) : [];
  const free = rows.filter((r) => r.available).length;
  const input = "h-10 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-foreground";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarSearch className="size-4 text-gold" aria-hidden /> {a.title}
        </CardTitle>
        <p className="text-xs text-muted">{a.subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form method="get" action="/calendar" className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_7rem_1fr_7rem_auto] sm:items-end">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={anchor} />
          <label className="space-y-1 text-xs text-muted">
            <span>{a.from}</span>
            <input type="date" name="af" defaultValue={af} min={today} className={input} required />
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span className="invisible">h</span>
            <input type="time" name="at" defaultValue={at} className={input} required />
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span>{a.to}</span>
            <input type="date" name="bf" defaultValue={bf} min={today} className={input} required />
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span className="invisible">h</span>
            <input type="time" name="bt" defaultValue={bt} className={input} required />
          </label>
          <Button type="submit" className="col-span-2 sm:col-span-1">
            {a.search}
          </Button>
        </form>
        {searched && (
          <>
            <p className="text-sm text-muted">{interpolate(a.results, { n: free })}</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((r) => (
                <li key={r.vehicle_id} className={cn("flex flex-wrap items-center gap-2 p-3 sm:px-4", !r.available && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.label}</p>
                    <p className="text-xs text-muted">
                      <span className="font-mono">{r.plate}</span>
                      {r.category && ` · ${r.category}`}
                      {r.daily_price !== null && ` · ${interpolate(a.perDay, { price: formatCurrency(r.daily_price, locale) })}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.available ? (
                      <Badge variant="success">{a.available}</Badge>
                    ) : r.conflict_contract ? (
                      <Badge variant="danger">{interpolate(a.busy, { contract: r.conflict_contract })}</Badge>
                    ) : (
                      <Badge variant="neutral">{a.unavailable}</Badge>
                    )}
                    {r.maintenance_conflict && <Badge variant="warning">{a.maintenance}</Badge>}
                    {!r.insured && <Badge variant="danger">{a.uninsured}</Badge>}
                    {r.available && (
                      <Button asChild size="sm">
                        <Link href={`/rentals/new?${new URLSearchParams({ vehicle: r.vehicle_id, date: af, until: bf, pt: at, rt: bt })}`}>{a.book}</Link>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [{ t, locale }, sp] = await Promise.all([getI18n(), searchParams]);
  const c = t.calendar;
  const view = sp.view === "fleet" ? "fleet" : "month";
  const today = todayInMadrid();
  const anchor = isIsoDate(sp.date) ? sp.date : today;
  const ym = anchor.slice(0, 7);
  const weeks = monthMatrix(ym);
  const from = view === "month" ? weeks[0]![0]! : anchor;
  const to = view === "month" ? weeks[weeks.length - 1]![6]! : addDays(anchor, FLEET_DAYS - 1);
  const [events, vehicles] = await Promise.all([getCalendarEvents(from, to), view === "fleet" ? getFleetRows() : Promise.resolve([])]);
  const prev = view === "month" ? addMonths(anchor, -1) : addDays(anchor, -7);
  const next = view === "month" ? addMonths(anchor, 1) : addDays(anchor, 7);
  const label =
    view === "month"
      ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${ym}-15T00:00:00Z`))
      : `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`))} – ${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${to}T00:00:00Z`))}`;
  const nav = (d: string) => `/calendar?${new URLSearchParams({ view, date: d })}`;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.overview} title={c.title} description={c.subtitle} />
      <TabsNav
        active={view}
        tabs={[
          { key: "month", label: c.views.month, href: `/calendar?view=month&date=${anchor}` },
          { key: "fleet", label: c.views.fleet, href: `/calendar?view=fleet&date=${view === "fleet" ? anchor : today}` },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold first-letter:uppercase">{label}</h2>
        <div className="flex items-center gap-1.5">
          <Button asChild size="sm" variant="secondary">
            <Link href={nav(prev)} aria-label={c.prev}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={nav(today)}>{c.today}</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={nav(next)} aria-label={c.next}>
              <ChevronRight />
            </Link>
          </Button>
        </div>
      </div>
      {view === "month" ? (
        <MonthView ym={ym} events={events} t={t} locale={locale} today={today} />
      ) : (
        <>
          <FleetView start={anchor} events={events} vehicles={vehicles} t={t} locale={locale} today={today} />
          <p className="text-xs text-subtle">{c.fleetHint}</p>
        </>
      )}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {(["reservation", "confirmed", "in_progress", "late", "completed", "maintenance"] as const).map((k) => (
          <span key={k} className={cn("rounded border px-2 py-0.5", TONE[k])}>
            {c.legend[k]}
          </span>
        ))}
        <span className={cn("rounded border px-2 py-0.5", TONE.deadline)}>
          {c.kinds.insurance_end} / {c.kinds.itv} / {c.kinds.fine_payment}
        </span>
      </div>
      <Availability sp={sp} t={t} locale={locale} view={view} anchor={anchor} />
    </div>
  );
}
