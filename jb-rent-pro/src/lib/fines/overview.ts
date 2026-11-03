import type { Fine } from "./queries";

/** Resumo calculado sobre as multas ativas. */
export function finesOverview(rows: Fine[], today: string) {
  const year = today.slice(0, 4);
  const in7 = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
  const cents = (v: number | null) => Math.round((v ?? 0) * 100);
  return {
    open: rows.filter((r) => r.status === "pending" || r.status === "appealed").length,
    identifyDue: rows.filter((r) => r.status === "pending" && r.identification_deadline && r.identification_deadline <= in7).length,
    toRecover: rows.filter((r) => r.status !== "cancelled" && r.recharge_amount && !r.recharge_paid_at).reduce((a, r) => a + cents(r.recharge_amount), 0) / 100,
    paidYear: rows.filter((r) => r.status === "paid" && r.paid_at?.startsWith(year)).reduce((a, r) => a + cents(r.paid_amount), 0) / 100,
  };
}
