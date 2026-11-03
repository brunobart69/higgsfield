import { describe, expect, it } from "vitest";
import { alertBand, daysLeft, policyStatus, renewalPeriod } from "@/lib/insurance/status";
import { insuranceSchema } from "@/lib/validation/insurance";
import { documentSchema } from "@/lib/validation/documents";
import { mergeAlerts } from "@/lib/dashboard/alerts";
import type { DashboardAlert } from "@/lib/dashboard/queries";

const today = "2026-11-03";
const P = (start_date: string, end_date: string, extra: Partial<{ renewed: boolean; archived_at: string | null }> = {}) => ({
  start_date,
  end_date,
  renewed: false,
  archived_at: null,
  ...extra,
});

describe("situação da apólice", () => {
  it("classifica vigente, vencendo, vencida, futura, renovada e arquivada", () => {
    expect(policyStatus(P("2026-01-01", "2027-01-01"), today)).toBe("active");
    expect(policyStatus(P("2026-01-01", "2026-12-03"), today)).toBe("expiring"); // 30 dias
    expect(policyStatus(P("2026-01-01", "2026-12-04"), today)).toBe("active"); // 31 dias
    expect(policyStatus(P("2025-11-01", "2026-11-02"), today)).toBe("expired");
    expect(policyStatus(P("2025-11-01", "2026-11-02", { renewed: true }), today)).toBe("renewed");
    expect(policyStatus(P("2026-01-01", "2026-11-10", { renewed: true }), today)).toBe("active");
    expect(policyStatus(P("2026-12-01", "2027-12-01"), today)).toBe("upcoming");
    expect(policyStatus(P("2026-01-01", "2027-01-01", { archived_at: "2026-05-01" }), today)).toBe("archived");
    expect(policyStatus(P("2026-01-01", today), today)).toBe("expiring"); // último dia ainda vigente
  });

  it("faixas de alerta 30/15/7/vencida", () => {
    expect(daysLeft("2026-11-10", today)).toBe(7);
    expect(alertBand("2026-12-04", today)).toBeNull();
    expect(alertBand("2026-12-03", today)).toBe(30);
    expect(alertBand("2026-11-18", today)).toBe(15);
    expect(alertBand("2026-11-19", today)).toBe(30);
    expect(alertBand("2026-11-10", today)).toBe(7);
    expect(alertBand(today, today)).toBe(7);
    expect(alertBand("2026-11-02", today)).toBe(0);
  });

  it("renovação começa no dia seguinte e mantém a duração (inclusive ano bissexto)", () => {
    expect(renewalPeriod("2025-11-15", "2026-11-14")).toEqual({ start: "2026-11-15", end: "2027-11-14" });
    expect(renewalPeriod("2027-03-01", "2028-02-29")).toEqual({ start: "2028-03-01", end: "2029-02-28" });
    expect(renewalPeriod("2026-01-01", "2026-06-30")).toEqual({ start: "2026-07-01", end: "2026-12-31" });
    expect(renewalPeriod("2026-01-10", "2026-02-18")).toEqual({ start: "2026-02-19", end: "2026-03-30" }); // 39 dias
  });
});

describe("validação de apólice", () => {
  const base = {
    id: "",
    vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002",
    renewed_from_id: "",
    insurer: "Mapfre",
    policy_number: "MP-1",
    coverage_type: "",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    premium_amount: "1.240,50",
    deductible_amount: "",
    assistance_phone: "",
    paid_at: "",
    payment_method: "",
    notes: "",
  };
  it("aceita e converte valores", () => {
    const r = insuranceSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.premium_amount).toBe("1240.50");
      expect(r.data.roadside_assistance).toBe(false);
      expect(r.data.id).toBeNull();
    }
  });
  it("rejeita fim antes do início e pagamento sem prêmio", () => {
    const a = insuranceSchema.safeParse({ ...base, end_date: "2025-12-31" });
    expect(a.success).toBe(false);
    expect(a.error?.issues[0]).toMatchObject({ path: ["end_date"], message: "endBeforeStart" });
    const b = insuranceSchema.safeParse({ ...base, premium_amount: "", paid_at: "2026-01-05" });
    expect(b.error?.issues[0]).toMatchObject({ path: ["premium_amount"] });
  });
  it("exige veículo, seguradora e número", () => {
    const r = insuranceSchema.safeParse({ ...base, vehicle_id: "", insurer: "", policy_number: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(["insurer", "policy_number", "vehicle_id"]);
  });
});

describe("validação de documento", () => {
  const doc = {
    path: "c0000000-0000-4000-8000-000000000001/company/general/documents/x.pdf",
    category: "receipt",
    title: "Recibo",
    mime_type: "application/pdf",
    size_bytes: 1200,
    vehicle_id: "",
    rental_id: null,
    insurance_policy_id: undefined,
  };
  it("normaliza vínculos vazios", () => {
    const r = documentSchema.safeParse(doc);
    expect(r.success).toBe(true);
    if (r.success) expect([r.data.vehicle_id, r.data.rental_id, r.data.insurance_policy_id]).toEqual([null, null, null]);
  });
  it("rejeita categoria e formato desconhecidos", () => {
    expect(documentSchema.safeParse({ ...doc, category: "x" }).success).toBe(false);
    expect(documentSchema.safeParse({ ...doc, mime_type: "text/html" }).success).toBe(false);
  });
});

describe("alertas", () => {
  const a = (kind: DashboardAlert["kind"], severity: DashboardAlert["severity"], due: string | null): DashboardAlert => ({
    kind,
    severity,
    entity: "vehicles",
    entity_id: kind,
    title: kind,
    due_date: due,
  });
  it("ordena por gravidade e data", () => {
    const out = mergeAlerts([a("itv_expiring", "medium", "2026-11-20"), a("rental_overdue", "high", "2026-11-01")], [
      a("vehicle_uninsured", "critical", null),
      a("document_expiring", "medium", "2026-11-05"),
    ]);
    expect(out.map((x) => x.kind)).toEqual(["vehicle_uninsured", "rental_overdue", "document_expiring", "itv_expiring"]);
  });
});
