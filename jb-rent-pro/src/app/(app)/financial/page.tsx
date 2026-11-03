import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Bot, Info, Percent, Scale, Wallet } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";
import { ENTRIES_PAGE_SIZE, getCashFlow, getCashOpening, getFinanceReport, getOpenItems, listEntries, type OpenItem } from "@/lib/finance/queries";
import { getVehicleOptions } from "@/lib/fines/queries";
import { ENTRY_STATUSES, ENTRY_STATUS_VARIANT, EXPENSE_CATEGORIES, INCOME_CATEGORIES, type EntryStatus } from "@/lib/finance/constants";
import { addDays, addMonths, endOfMonth, isPeriodKey, resolvePeriod, todayInMadrid } from "@/lib/periods";
import { parsePage } from "@/lib/search";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav } from "@/components/ui/tabs-nav";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { CashFlowChart } from "@/components/dashboard/charts";
import { CategoryBars } from "@/components/finance/category-bars";
import { EntryDialog } from "@/components/finance/entry-dialog";
import { EntryActions } from "@/components/finance/entry-actions";
import { OpeningBalanceDialog } from "@/components/finance/opening-dialog";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.financial.title };
}

const TABS = ["summary", "entries", "open", "cashflow"] as const;
type Tab = (typeof TABS)[number];
type SP = { tab?: string; period?: string; from?: string; to?: string; basis?: string; type?: string; status?: string; category?: string; q?: string; page?: string };

export default async function FinancialPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [{ t, locale }, sp, session, vehicles] = await Promise.all([getI18n(), searchParams, getSession(), getVehicleOptions()]);
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "summary";
  const fi = t.financial;
  const period = resolvePeriod(isPeriodKey(sp.period) ? sp.period : "thisMonth", { from: sp.from, to: sp.to });
  const isOwner = session.status === "ok" && session.profile.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t.nav.groups.finance} title={fi.title} description={fi.subtitle} actions={<EntryDialog values={{}} vehicles={vehicles} />} />
      <TabsNav active={tab} tabs={TABS.map((k) => ({ key: k, label: fi.tabs[k], href: k === "summary" ? "/financial" : `/financial?tab=${k}` }))} />
      {tab === "summary" && <Summary t={t} locale={locale} sp={sp} period={period} />}
      {tab === "entries" && <Entries t={t} locale={locale} sp={sp} period={period} vehicles={vehicles} />}
      {tab === "open" && <Open t={t} locale={locale} />}
      {tab === "cashflow" && <CashFlow t={t} isOwner={isOwner} locale={locale} />}
    </div>
  );
}

async function Summary({ t, locale, sp, period }: { t: Dictionary; locale: Locale; sp: SP; period: ReturnType<typeof resolvePeriod> }) {
  const fi = t.financial;
  const basis = sp.basis === "cash" ? "cash" : "accrual";
  const r = await getFinanceReport(period.from, period.to, basis);
  const keep = { tab: undefined, basis: basis === "cash" ? "cash" : undefined };
  const qs = (b: string) => {
    const p = new URLSearchParams({ period: period.key, ...(period.key === "custom" ? { from: period.from, to: period.to } : {}), ...(b === "cash" ? { basis: "cash" } : {}) });
    return `/financial?${p}`;
  };
  const income = r?.byCategory.filter((x) => x.type === "income") ?? [];
  const expense = r?.byCategory.filter((x) => x.type === "expense") ?? [];
  const margin = r && r.income > 0 ? Math.round((r.result / r.income) * 1000) / 10 : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <PeriodFilter value={period.key} from={period.from} to={period.to} keep={keep} />
        <div className="flex shrink-0 gap-1.5" role="radiogroup" aria-label="basis">
          {(["accrual", "cash"] as const).map((b) => (
            <Link
              key={b}
              href={qs(b)}
              role="radio"
              aria-checked={basis === b}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium",
                basis === b ? "border-gold/50 bg-gold/15 text-gold-light" : "border-border bg-surface-2 text-muted hover:text-foreground",
              )}
            >
              {fi.basis[b]}
            </Link>
          ))}
        </div>
      </div>
      <p className="flex items-start gap-2 text-sm text-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden /> {fi.basisHint[basis]}
      </p>
      {!r ? (
        <EmptyState icon={AlertTriangle} title={t.errors.loadFailed} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={fi.kpis.income} value={formatCurrency(r.income, locale)} icon={ArrowUpCircle} tone="gold" emphasis />
            <KpiCard label={fi.kpis.expenses} value={formatCurrency(r.expenses, locale)} icon={ArrowDownCircle} tone="info" />
            <KpiCard label={fi.kpis.result} value={formatCurrency(r.result, locale)} icon={Scale} tone={r.result < 0 ? "danger" : "success"} />
            <KpiCard label={fi.kpis.margin} value={margin === null ? "—" : `${margin.toLocaleString(locale)} %`} icon={Percent} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{fi.incomeTitle}</CardTitle>
              </CardHeader>
              <CardContent>{income.length ? <CategoryBars rows={income} labels={t.financeCategories} locale={locale} tone="income" /> : <p className="text-sm text-muted">{fi.empty}</p>}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{fi.expenseTitle}</CardTitle>
              </CardHeader>
              <CardContent>{expense.length ? <CategoryBars rows={expense} labels={t.financeCategories} locale={locale} tone="expense" /> : <p className="text-sm text-muted">{fi.empty}</p>}</CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{fi.nonOperational}</CardTitle>
              <p className="text-xs text-muted">{fi.nonOperationalHint}</p>
            </CardHeader>
            <CardContent>
              {r.nonOperational.length === 0 ? (
                <p className="text-sm text-muted">{fi.empty}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {r.nonOperational.map((x) => (
                    <li key={`${x.type}-${x.category}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-muted">{t.financeCategories[x.category as keyof typeof t.financeCategories] ?? x.category}</span>
                      <span className={x.type === "income" ? "text-success tabular" : "tabular"}>
                        {x.type === "income" ? "+" : "−"} {formatCurrency(x.total, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <p className="text-xs text-subtle">
            {fi.depositsNote} {fi.taxNote}
          </p>
        </>
      )}
    </div>
  );
}

async function Entries({
  t,
  locale,
  sp,
  period,
  vehicles,
}: {
  t: Dictionary;
  locale: Locale;
  sp: SP;
  period: ReturnType<typeof resolvePeriod>;
  vehicles: Array<{ value: string; label: string }>;
}) {
  const fi = t.financial;
  const e = fi.entries;
  const type = sp.type === "income" || sp.type === "expense" ? sp.type : undefined;
  const status = (ENTRY_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as EntryStatus) : undefined;
  const cats: readonly string[] = type === "income" ? INCOME_CATEGORIES : type === "expense" ? EXPENSE_CATEGORIES : [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
  const category = sp.category && cats.includes(sp.category) ? sp.category : undefined;
  const page = parsePage(sp.page);
  const res = await listEntries({ from: period.from, to: period.to, type, status, category, q: sp.q, page });
  const totalPages = Math.max(1, Math.ceil(res.total / ENTRIES_PAGE_SIZE));
  const base: Record<string, string | undefined> = {
    tab: "entries",
    period: period.key,
    from: period.key === "custom" ? period.from : undefined,
    to: period.key === "custom" ? period.to : undefined,
    type,
    status,
    category,
    q: sp.q,
  };
  const href = (over: Record<string, string | undefined>) => {
    const p = Object.entries({ ...base, ...over }).filter((x): x is [string, string] => !!x[1]);
    return `/financial?${new URLSearchParams(p)}`;
  };
  const chip = (active: boolean) =>
    cn("inline-flex h-8 shrink-0 items-center rounded-md border px-3 text-xs", active ? "border-gold/50 text-gold-light" : "border-border text-subtle hover:text-foreground");
  return (
    <div className="space-y-4">
      <PeriodFilter value={period.key} from={period.from} to={period.to} keep={{ tab: "entries", type, status, category, q: sp.q }} />
      <ListToolbar action="/financial" q={sp.q} placeholder={e.searchPlaceholder} searchLabel={t.common.search} hidden={{ ...base, q: undefined }} />
      <div className="scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {[undefined, "income", "expense"].map((k) => (
          <Link key={k ?? "all"} href={href({ type: k, category: undefined, page: undefined })} className={chip(type === k)} scroll={false}>
            {k ? fi.fields.types[k as "income" | "expense"] : e.allTypes}
          </Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-border" aria-hidden />
        {[undefined, ...ENTRY_STATUSES].map((k) => (
          <Link key={k ?? "alls"} href={href({ status: k, page: undefined })} className={chip(status === k)} scroll={false}>
            {k ? fi.statuses[k] : e.allStatuses}
          </Link>
        ))}
      </div>
      {type && (
        <div className="scrollbar-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {[undefined, ...cats].map((c) => (
            <Link key={c ?? "allc"} href={href({ category: c, page: undefined })} className={chip(category === c)} scroll={false}>
              {c ? t.financeCategories[c as keyof typeof t.financeCategories] : e.allCategories}
            </Link>
          ))}
        </div>
      )}
      {res.items.length === 0 ? (
        <EmptyState icon={Wallet} title={fi.empty} />
      ) : (
        <>
          <Card className="divide-y divide-border overflow-hidden">
            {res.items.map((x) => (
              <div key={x.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("truncate text-sm font-medium", x.status === "cancelled" && "text-subtle line-through")}>{x.description}</span>
                    <Badge variant={ENTRY_STATUS_VARIANT[x.status]}>{fi.statuses[x.status]}</Badge>
                    {!x.is_operational && <Badge variant="info">{fi.nonOperational}</Badge>}
                    {x.auto && (
                      <Badge variant="neutral">
                        <Bot className="mr-1 inline size-3" aria-hidden />
                        {e.auto}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted tabular">
                    <span>{t.financeCategories[x.category as keyof typeof t.financeCategories] ?? x.category}</span>
                    <span>· {formatDate(x.competence_date)}</span>
                    {x.due_date && x.status === "pending" && (
                      <span className={x.due_date < todayInMadrid() ? "text-danger" : undefined}>
                        · {fi.fields.due_date}: {formatDate(x.due_date)}
                      </span>
                    )}
                    {x.paid_at && <span>· {fi.fields.paid_at}: {formatDate(x.paid_at)}</span>}
                    {x.plate && <span className="font-mono">· {x.plate}</span>}
                    {x.installment_no && <span>· {interpolate(e.installment, { n: x.installment_no, total: x.installment_count ?? x.installment_no })}</span>}
                    {x.origin && (
                      <Link href={x.origin.href} className="text-gold-light hover:underline">
                        · {e.origins[x.origin.kind as keyof typeof e.origins]}
                      </Link>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className={cn("text-sm font-semibold tabular sm:min-w-24 sm:text-right", x.type === "income" ? "text-success" : "", x.status === "cancelled" && "text-subtle line-through")}>
                    {x.type === "income" ? "+" : "−"} {formatCurrency(x.amount, locale)}
                  </span>
                  {!x.auto && x.status === "pending" && (
                    <>
                      <EntryActions id={x.id} type={x.type} method={x.payment_method} />
                      <EntryDialog values={x} vehicles={vehicles} size="sm" iconOnly />
                    </>
                  )}
                </div>
              </div>
            ))}
          </Card>
          <Pagination
            page={page}
            totalPages={totalPages}
            hrefFor={(p) => href({ page: String(p) })}
            labels={{ previous: t.common.previous, next: t.common.next, page: interpolate(t.common.page, { page, total: totalPages }) }}
          />
        </>
      )}
    </div>
  );
}

function OpenList({ items, t, locale, today, type }: { items: OpenItem[]; t: Dictionary; locale: Locale; today: string; type: "income" | "expense" }) {
  const o = t.financial.open;
  const soon = addDays(today, 7);
  const total = items.reduce((a, x) => a + Math.round(x.amount * 100), 0) / 100;
  const overdue = items.filter((x) => x.due_date && x.due_date < today).reduce((a, x) => a + Math.round(x.amount * 100), 0) / 100;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{type === "income" ? o.receivable : o.payable}</CardTitle>
        <p className="text-sm tabular">
          {o.total}: <span className="font-semibold">{formatCurrency(total, locale)}</span>
          {overdue > 0 && <span className="ml-3 text-danger">{o.overdueTotal}: {formatCurrency(overdue, locale)}</span>}
        </p>
      </CardHeader>
      <CardContent className={items.length ? "p-0" : undefined}>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{type === "income" ? o.emptyReceivable : o.emptyPayable}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((x) => {
              const late = !!x.due_date && x.due_date < today;
              const near = !late && !!x.due_date && x.due_date <= soon;
              return (
                <li key={`${x.kind}-${x.id}`} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {x.kind === "rental" ? (
                        <Link href={`/rentals/${x.id}`} className="font-mono text-sm hover:underline">
                          {x.description}
                        </Link>
                      ) : (
                        <span className="truncate text-sm font-medium">{x.description}</span>
                      )}
                      {late && <Badge variant="danger">{o.overdue}</Badge>}
                      {near && <Badge variant="warning">{o.dueSoon}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {x.kind === "rental" ? o.rentalBalance : (t.financeCategories[x.category as keyof typeof t.financeCategories] ?? x.category)}
                      {x.customer && ` · ${x.customer}`}
                      {x.plate && <span className="font-mono"> · {x.plate}</span>}
                      {` · ${x.due_date ? formatDate(x.due_date) : o.noDue}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <span className="text-sm font-semibold tabular">{formatCurrency(x.amount, locale)}</span>
                    {x.kind === "entry" && <EntryActions id={x.id} type={type} method={null} canCancel={false} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function Open({ t, locale }: { t: Dictionary; locale: Locale }) {
  const [rec, pay] = await Promise.all([getOpenItems("income"), getOpenItems("expense")]);
  const today = todayInMadrid();
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <OpenList items={rec} t={t} locale={locale} today={today} type="income" />
      <OpenList items={pay} t={t} locale={locale} today={today} type="expense" />
    </div>
  );
}

async function CashFlow({ t, isOwner, locale }: { t: Dictionary; isOwner: boolean; locale: Locale }) {
  const today = todayInMadrid();
  const from = addMonths(today, -11);
  const to = endOfMonth(addMonths(today, 3));
  const [raw, opening] = await Promise.all([getCashFlow(from, to), getCashOpening()]);
  // meses futuros: saldo projetado = saldo anterior + a receber − a pagar
  const current = today.slice(0, 7);
  let running = 0;
  const rows = raw.map((r) => {
    if (r.month.slice(0, 7) <= current) {
      running = r.balance + (r.month.slice(0, 7) === current ? r.projected_in - r.projected_out : 0);
      return r;
    }
    running = Math.round((running + r.projected_in - r.projected_out) * 100) / 100;
    return { ...r, balance: running };
  });
  const c = t.financial.cashflow;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-muted">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
          {opening.balance !== null && opening.date
            ? interpolate(c.openingSet, { amount: formatCurrency(opening.balance, locale), date: formatDate(opening.date) })
            : c.openingMissing}
        </p>
        {isOwner && <OpeningBalanceDialog balance={opening.balance} date={opening.date} />}
      </div>
      <CashFlowChart data={rows} title={c.title} subtitle={c.subtitle} />
      <p className="text-xs text-subtle">{t.financial.depositsNote}</p>
    </div>
  );
}
