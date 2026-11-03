import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCashFlow, getFinanceReport, getFleetRoi, getOpenItems } from "@/lib/finance/queries";
import { vehicleReturns } from "@/lib/finance/constants";
import { formatDate } from "@/lib/format";
import { madridLocalToIso } from "@/lib/rentals/datetime";
import { addDays, todayInMadrid } from "@/lib/periods";
import { interpolate } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Column, ReportDoc, Row } from "./types";

import { SNAPSHOT_REPORTS, type ReportKey } from "./keys";
const LIMIT = 5000;

type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const sum = (rows: Row[], key: string) => rows.reduce((a, r) => a + Math.round(Number(r[key] ?? 0) * 100), 0) / 100;
type CustomerRel = { full_name: string | null; company_name: string | null; customer_type: string };
const cname = (c: CustomerRel | null) => (c ? ((c.customer_type === "company" ? c.company_name : c.full_name) ?? "") : "");

export type ReportParams = { from: string; to: string; basis: "accrual" | "cash" };

export async function buildReport(key: ReportKey, p: ReportParams, t: Dictionary): Promise<ReportDoc> {
  const r = t.reports;
  const c = r.cols;
  const cat = (k: string) => t.financeCategories[k as keyof typeof t.financeCategories] ?? k;
  const period = SNAPSHOT_REPORTS.includes(key) ? interpolate(r.asOf, { date: formatDate(todayInMadrid()) }) : `${formatDate(p.from)} – ${formatDate(p.to)}`;
  const base = { key, title: r.catalog[key].title, subtitle: r.catalog[key].desc, period, notes: [] as string[] };
  const col = (key: string, label: string, type: Column["type"]): Column => ({ key, label, type });
  const supabase = await createClient();

  switch (key) {
    case "pnl": {
      const f = await getFinanceReport(p.from, p.to, p.basis);
      const inc = (f?.byCategory ?? []).filter((x) => x.type === "income").map((x) => ({ category: cat(x.category), total: x.total }));
      const exp = (f?.byCategory ?? []).filter((x) => x.type === "expense").map((x) => ({ category: cat(x.category), total: x.total }));
      const non = (f?.nonOperational ?? []).map((x) => ({ category: cat(x.category), type: t.financial.fields.types[x.type], total: x.type === "income" ? x.total : -x.total }));
      const cols = [col("category", c.category, "text"), col("total", c.amount, "money")];
      return {
        ...base,
        subtitle: `${base.subtitle} · ${t.financial.basis[p.basis]}`,
        sections: [
          {
            title: r.sections.summary,
            columns: [col("label", c.description, "text"), col("value", c.amount, "money")],
            rows: [
              { label: t.financial.kpis.income, value: f?.income ?? 0 },
              { label: t.financial.kpis.expenses, value: f?.expenses ?? 0 },
            ],
            totals: { label: t.financial.kpis.result, value: f?.result ?? 0 },
          },
          { title: t.financial.incomeTitle, columns: cols, rows: inc, totals: { category: c.total, total: sum(inc, "total") }, empty: r.empty },
          { title: t.financial.expenseTitle, columns: cols, rows: exp, totals: { category: c.total, total: sum(exp, "total") }, empty: r.empty },
          { title: t.financial.nonOperational, columns: [col("category", c.category, "text"), col("type", c.type, "text"), col("total", c.amount, "money")], rows: non, empty: r.empty },
        ],
        notes: [t.financial.basisHint[p.basis], t.financial.nonOperationalHint, t.financial.depositsNote, t.financial.taxNote],
      };
    }
    case "entries": {
      const { data } = await supabase
        .from("financial_transactions")
        .select("competence_date, due_date, paid_at, type, category, description, amount, vat_rate, status, payment_method, reference, is_operational, vehicles(plate)")
        .is("archived_at", null)
        .gte("competence_date", p.from)
        .lte("competence_date", p.to)
        .order("competence_date")
        .limit(LIMIT);
      const rows: Row[] = (data ?? []).map((x) => ({
        competence_date: x.competence_date,
        type: t.financial.fields.types[x.type as "income" | "expense"],
        category: cat(x.category),
        description: x.description,
        plate: one(x.vehicles as Rel<{ plate: string }>)?.plate ?? "",
        amount: x.type === "expense" ? -Number(x.amount) : Number(x.amount),
        vat_rate: num(x.vat_rate),
        status: t.financial.statuses[x.status as "pending" | "paid" | "cancelled"],
        due_date: x.due_date,
        paid_at: x.paid_at,
        method: x.payment_method ? t.paymentMethods[x.payment_method as keyof typeof t.paymentMethods] : "",
        reference: x.reference ?? "",
        operational: x.is_operational ? t.common.yes : t.common.no,
      }));
      return {
        ...base,
        landscape: true,
        sections: [
          {
            title: r.catalog.entries.title,
            columns: [
              col("competence_date", c.competence, "date"),
              col("type", c.type, "text"),
              col("category", c.category, "text"),
              col("description", c.description, "text"),
              col("plate", c.plate, "text"),
              col("amount", c.amount, "money"),
              col("vat_rate", c.vat, "percent"),
              col("status", c.status, "text"),
              col("due_date", c.due, "date"),
              col("paid_at", c.paidAt, "date"),
              col("method", c.method, "text"),
              col("reference", c.reference, "text"),
              col("operational", c.operational, "text"),
            ],
            rows,
            empty: r.empty,
          },
        ],
        notes: [r.notes.entriesSign, r.notes.cancelledIncluded, t.financial.taxNote],
      };
    }
    case "cashflow": {
      const rows = (await getCashFlow(p.from, p.to)).map((x) => ({ ...x }));
      return {
        ...base,
        landscape: true,
        sections: [
          {
            title: r.catalog.cashflow.title,
            columns: [
              col("month", c.month, "date"),
              col("inflow", t.financial.cashflow.inflow, "money"),
              col("outflow", t.financial.cashflow.outflow, "money"),
              col("net", t.financial.cashflow.net, "money"),
              col("balance", t.financial.cashflow.balance, "money"),
              col("projected_in", t.financial.cashflow.projectedIn, "money"),
              col("projected_out", t.financial.cashflow.projectedOut, "money"),
              col("deposits_in", r.cols.depositsIn, "money"),
              col("deposits_out", r.cols.depositsOut, "money"),
            ],
            rows,
            totals: { month: null, inflow: sum(rows, "inflow"), outflow: sum(rows, "outflow"), net: sum(rows, "net") },
          },
        ],
        notes: [t.financial.depositsNote],
      };
    }
    case "receivables":
    case "payables": {
      const items = await getOpenItems(key === "receivables" ? "income" : "expense");
      const rows: Row[] = items.map((x) => ({
        due_date: x.due_date,
        description: x.description,
        category: x.kind === "rental" ? t.financial.open.rentalBalance : cat(x.category),
        customer: x.customer ?? "",
        plate: x.plate ?? "",
        amount: x.amount,
        overdue: x.due_date && x.due_date < todayInMadrid() ? t.common.yes : "",
      }));
      return {
        ...base,
        sections: [
          {
            title: r.catalog[key].title,
            columns: [
              col("due_date", c.due, "date"),
              col("description", c.description, "text"),
              col("category", c.category, "text"),
              col("customer", c.customer, "text"),
              col("plate", c.plate, "text"),
              col("amount", c.amount, "money"),
              col("overdue", t.financial.open.overdue, "text"),
            ],
            rows,
            totals: { description: c.total, amount: sum(rows, "amount") },
            empty: r.empty,
          },
        ],
      };
    }
    case "rentals": {
      const { data } = await supabase
        .from("rentals")
        .select("contract_number, status, pickup_at, return_at, actual_return_at, total_amount, deposit_amount, customers(full_name, company_name, customer_type), vehicles(plate, brand, model)")
        .is("archived_at", null)
        .gte("pickup_at", madridLocalToIso(p.from, "00:00")!)
        .lt("pickup_at", madridLocalToIso(addDays(p.to, 1), "00:00")!)
        .order("pickup_at")
        .limit(LIMIT);
      const { data: pays } = await supabase.from("rental_payments").select("rental_id, kind, amount, rentals!inner(contract_number)").is("voided_at", null).limit(20000);
      const paid = new Map<string, number>();
      for (const x of pays ?? []) {
        const k = one(x.rentals as Rel<{ contract_number: string }>)?.contract_number ?? "";
        paid.set(k, (paid.get(k) ?? 0) + (x.kind === "refund" ? -Number(x.amount) : Number(x.amount)));
      }
      const rows: Row[] = (data ?? []).map((x) => {
        const v = one(x.vehicles as Rel<{ plate: string; brand: string; model: string }>);
        const pd = Math.round((paid.get(x.contract_number) ?? 0) * 100) / 100;
        return {
          contract: x.contract_number,
          status: t.rentalStatus[x.status as keyof typeof t.rentalStatus] ?? x.status,
          customer: cname(one(x.customers as Rel<CustomerRel>)),
          vehicle: v ? `${v.plate} · ${v.brand} ${v.model}` : "",
          pickup: x.pickup_at,
          return: x.actual_return_at ?? x.return_at,
          total: Number(x.total_amount),
          paid: pd,
          balance: x.status === "cancelled" ? 0 : Math.max(0, Math.round((Number(x.total_amount) - pd) * 100) / 100),
          deposit: Number(x.deposit_amount),
        };
      });
      return {
        ...base,
        landscape: true,
        sections: [
          {
            title: r.catalog.rentals.title,
            columns: [
              col("contract", c.contract, "text"),
              col("status", c.status, "text"),
              col("customer", c.customer, "text"),
              col("vehicle", c.vehicle, "text"),
              col("pickup", c.pickup, "datetime"),
              col("return", c.return, "datetime"),
              col("total", c.total, "money"),
              col("paid", c.paid, "money"),
              col("balance", c.balance, "money"),
              col("deposit", c.deposit, "money"),
            ],
            rows,
            totals: { contract: c.total, total: sum(rows, "total"), paid: sum(rows, "paid"), balance: sum(rows, "balance") },
            empty: r.empty,
          },
        ],
        notes: [r.notes.rentalsByPickup, t.financial.depositsNote],
      };
    }
    case "fleet": {
      const { data } = await supabase.rpc("dashboard_vehicle_performance", { p_from: p.from, p_to: p.to });
      const rows: Row[] = ((data ?? []) as Array<Record<string, unknown>>).map((x) => ({
        vehicle: `${x.plate} · ${x.label}`,
        revenue: Number(x.revenue),
        expenses: Number(x.expenses),
        profit: Number(x.profit),
        rented_days: Number(x.rented_days),
        available_days: Number(x.available_days),
        occupancy: Number(x.occupancy_pct),
      }));
      return {
        ...base,
        sections: [
          {
            title: r.catalog.fleet.title,
            columns: [
              col("vehicle", c.vehicle, "text"),
              col("revenue", c.revenue, "money"),
              col("expenses", c.expenses, "money"),
              col("profit", c.profit, "money"),
              col("rented_days", c.rentedDays, "number"),
              col("available_days", c.availableDays, "number"),
              col("occupancy", c.occupancy, "percent"),
            ],
            rows,
            totals: { vehicle: c.total, revenue: sum(rows, "revenue"), expenses: sum(rows, "expenses"), profit: sum(rows, "profit"), rented_days: sum(rows, "rented_days") },
            empty: r.empty,
          },
        ],
        notes: [r.notes.accrual],
      };
    }
    case "roi": {
      const rows: Row[] = (await getFleetRoi()).map((x) => {
        const v = vehicleReturns(x);
        return {
          vehicle: `${x.plate} · ${x.label}`,
          status: t.vehicles.status[x.status as keyof typeof t.vehicles.status] ?? x.status,
          acquisition: x.acquisition_date,
          purchase: x.purchase_price,
          value: x.current_value,
          depreciation: v.depreciation,
          revenue: x.revenue,
          expenses: x.expenses,
          profit: x.profit,
          monthly: v.monthlyProfit,
          roi: v.roi,
          total_return: v.totalReturn,
          payback: v.paybackMonths,
        };
      });
      return {
        ...base,
        landscape: true,
        sections: [
          {
            title: r.catalog.roi.title,
            columns: [
              col("vehicle", c.vehicle, "text"),
              col("status", c.status, "text"),
              col("acquisition", c.acquisition, "date"),
              col("purchase", t.assets.table.purchase, "money"),
              col("value", t.assets.table.value, "money"),
              col("depreciation", t.assets.table.depreciation, "money"),
              col("revenue", c.revenue, "money"),
              col("expenses", c.expenses, "money"),
              col("profit", c.profit, "money"),
              col("monthly", t.assets.table.monthly, "money"),
              col("roi", t.assets.table.roi, "percent"),
              col("total_return", t.assets.table.totalReturn, "percent"),
              col("payback", r.cols.paybackMonths, "number"),
            ],
            rows,
            totals: { vehicle: c.total, purchase: sum(rows, "purchase"), value: sum(rows, "value"), depreciation: sum(rows, "depreciation"), revenue: sum(rows, "revenue"), expenses: sum(rows, "expenses"), profit: sum(rows, "profit") },
            empty: r.empty,
          },
        ],
        notes: [t.assets.explain],
      };
    }
    case "maintenance": {
      const { data } = await supabase
        .from("maintenance_records")
        .select("completed_date, maintenance_type, title, workshop, mileage, cost, invoice_number, paid_at, vehicles(plate)")
        .is("archived_at", null)
        .eq("status", "completed")
        .gte("completed_date", p.from)
        .lte("completed_date", p.to)
        .order("completed_date")
        .limit(LIMIT);
      const rows: Row[] = (data ?? []).map((x) => ({
        date: x.completed_date,
        plate: one(x.vehicles as Rel<{ plate: string }>)?.plate ?? "",
        type: t.maintenance.types[x.maintenance_type as keyof typeof t.maintenance.types],
        title: x.title,
        workshop: x.workshop ?? "",
        mileage: num(x.mileage),
        cost: num(x.cost),
        invoice: x.invoice_number ?? "",
        paid_at: x.paid_at,
      }));
      return {
        ...base,
        landscape: true,
        sections: [
          {
            title: r.catalog.maintenance.title,
            columns: [
              col("date", c.date, "date"),
              col("plate", c.plate, "text"),
              col("type", c.type, "text"),
              col("title", c.description, "text"),
              col("workshop", t.maintenance.fields.workshop, "text"),
              col("mileage", c.mileage, "number"),
              col("cost", c.amount, "money"),
              col("invoice", t.maintenance.fields.invoice_number, "text"),
              col("paid_at", c.paidAt, "date"),
            ],
            rows,
            totals: { date: null, title: c.total, cost: sum(rows, "cost") },
            empty: r.empty,
          },
        ],
      };
    }
    case "fines": {
      const { data } = await supabase
        .from("traffic_fines")
        .select("infraction_at, authority, reference, infraction, amount, status, paid_amount, recharge_amount, recharge_paid_at, vehicles(plate), rentals(contract_number), customers(full_name, company_name, customer_type)")
        .is("archived_at", null)
        .gte("infraction_at", madridLocalToIso(p.from, "00:00")!)
        .lt("infraction_at", madridLocalToIso(addDays(p.to, 1), "00:00")!)
        .order("infraction_at")
        .limit(LIMIT);
      const rows: Row[] = (data ?? []).map((x) => ({
        date: x.infraction_at,
        plate: one(x.vehicles as Rel<{ plate: string }>)?.plate ?? "",
        authority: [x.authority, x.reference].filter(Boolean).join(" · "),
        infraction: x.infraction,
        contract: one(x.rentals as Rel<{ contract_number: string }>)?.contract_number ?? "",
        customer: cname(one(x.customers as Rel<CustomerRel>)),
        status: t.fines.statuses[x.status as keyof typeof t.fines.statuses],
        amount: Number(x.amount),
        paid: num(x.paid_amount),
        recharge: num(x.recharge_amount),
        recharge_paid: x.recharge_paid_at,
      }));
      return {
        ...base,
        landscape: true,
        sections: [
          {
            title: r.catalog.fines.title,
            columns: [
              col("date", c.date, "datetime"),
              col("plate", c.plate, "text"),
              col("authority", t.fines.fields.authority, "text"),
              col("infraction", t.fines.fields.infraction, "text"),
              col("contract", c.contract, "text"),
              col("customer", c.customer, "text"),
              col("status", c.status, "text"),
              col("amount", c.amount, "money"),
              col("paid", t.fines.fields.paid_amount, "money"),
              col("recharge", t.fines.fields.recharge_amount, "money"),
              col("recharge_paid", t.fines.fields.recharge_paid_at, "date"),
            ],
            rows,
            totals: { date: null, infraction: c.total, amount: sum(rows, "amount"), paid: sum(rows, "paid"), recharge: sum(rows, "recharge") },
            empty: r.empty,
          },
        ],
      };
    }
    case "deposits": {
      const { data } = await supabase
        .from("deposits")
        .select("amount_received, amount_returned, amount_retained, balance, status, received_at, retention_reason, rentals(contract_number), customers(full_name, company_name, customer_type), vehicles(plate)")
        .neq("status", "settled")
        .order("received_at", { ascending: true, nullsFirst: false })
        .limit(LIMIT);
      const rows: Row[] = (data ?? []).map((x) => ({
        contract: one(x.rentals as Rel<{ contract_number: string }>)?.contract_number ?? "",
        customer: cname(one(x.customers as Rel<CustomerRel>)),
        plate: one(x.vehicles as Rel<{ plate: string }>)?.plate ?? "",
        status: t.deposits.status[x.status as keyof typeof t.deposits.status],
        received_at: x.received_at,
        received: Number(x.amount_received),
        returned: Number(x.amount_returned),
        retained: Number(x.amount_retained),
        balance: Number(x.balance),
      }));
      return {
        ...base,
        sections: [
          {
            title: r.catalog.deposits.title,
            columns: [
              col("contract", c.contract, "text"),
              col("customer", c.customer, "text"),
              col("plate", c.plate, "text"),
              col("status", c.status, "text"),
              col("received_at", c.date, "date"),
              col("received", t.deposits.received, "money"),
              col("returned", t.deposits.returned ?? c.amount, "money"),
              col("retained", t.deposits.retained ?? c.amount, "money"),
              col("balance", c.balance, "money"),
            ],
            rows,
            totals: { contract: c.total, received: sum(rows, "received"), balance: sum(rows, "balance") },
            empty: r.empty,
          },
        ],
        notes: [t.financial.depositsNote],
      };
    }
  }
}
