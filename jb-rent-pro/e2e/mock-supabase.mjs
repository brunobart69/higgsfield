// Supabase simulado para os testes E2E (dados fictícios; nenhum serviço real é contatado).
import http from "node:http";
import fs from "node:fs";
const IMG_DIR = new URL("./fixtures/", import.meta.url).pathname;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const user = { id: "11111111-1111-1111-1111-111111111111", aud: "authenticated", role: "authenticated", email: "joao@jbrent.es", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated", email: user.email, aud: "authenticated" })}.sig`;
const session = { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r", user };
const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2025, 11 + i, 1)); return d.toISOString().slice(0, 10); });
const monthly = months.map((m, i) => { const rev = 2800 + i * 260 + (i % 3) * 310; const ex = 1100 + (i % 4) * 280; return { month: m, revenue: rev, expenses: ex, profit: rev - ex, occupancy_pct: 52 + (i % 5) * 7.5, fleet_value: 61000 - i * 420 }; });
const rpc = {
  vehicle_conflicts: [],
  save_rental: "eeeeeeee-0000-0000-0000-000000000001",
  vehicle_financials: { revenue: 6250.0, expenses: 1180.4, investment: 24500, profit: 5069.6, rentals: 14, rented_days: 186, by_category: [{ type: "income", category: "rental", total: 5890 }, { type: "income", category: "excess_mileage", total: 360 }, { type: "expense", category: "maintenance", total: 640.4 }, { type: "expense", category: "cleaning", total: 300 }, { type: "expense", category: "tyres", total: 240 }] },
  customer_summary: { rentals: 2, active: 1, billed: 450, paid: 270, vehicles: 2, last_rental: "2026-11-01T09:00:00Z" },
  global_search: [{ kind: "vehicle", id: "aaaaaaaa-0000-0000-0000-000000000001", title: "Toyota Corolla 1.8 Hybrid Active Tech", subtitle: "1234 LKM", status: "rented" }, { kind: "customer", id: "cccccccc-0000-0000-0000-000000000001", title: "Maria García López", subtitle: "12345678Z · +34 611 22 33 44", status: "individual" }],

  dashboard_kpis: { vehicles_total: 3, vehicles_available: 1, vehicles_rented: 1, vehicles_reserved: 1, vehicles_maintenance: 0, revenue: 6120.5, expenses: 1840.15, operating_profit: 4280.35, active_contracts: 2, upcoming_returns: 1, insurance_expiring: 1, documents_expiring: 0 },
  dashboard_monthly: monthly,
  dashboard_vehicle_performance: [
    { vehicle_id: "a", label: "Toyota Corolla", plate: "1234 LKM", revenue: 2650, expenses: 420, profit: 2230, rented_days: 24, available_days: 30, occupancy_pct: 80 },
    { vehicle_id: "b", label: "Seat Ibiza", plate: "5678 MNB", revenue: 1980, expenses: 690, profit: 1290, rented_days: 19, available_days: 30, occupancy_pct: 63.3 },
    { vehicle_id: "c", label: "Kia Sportage", plate: "9012 PQR", revenue: 1490.5, expenses: 730.15, profit: 760.35, rented_days: 11, available_days: 30, occupancy_pct: 36.7 },
  ],
  refresh_notifications: 0,
  unread_notifications: 4,
  mark_notifications_read: 1,
  calendar_events: [
    { kind: "rental", id: "eeeeeeee-0000-0000-0000-000000000001", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", plate: "1234 LKM", title: "JB-2026-00015", subtitle: "Maria García López", starts_at: "2026-11-01T09:00:00Z", ends_at: "2026-11-05T09:00:00Z", all_day: false, status: "in_progress" },
    { kind: "rental", id: "r3", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000003", plate: "9012 PQR", title: "JB-2026-00016", subtitle: "Transportes Levante S.L.", starts_at: "2026-11-06T08:30:00Z", ends_at: "2026-11-13T08:30:00Z", all_day: false, status: "confirmed" },
    { kind: "rental", id: "r4", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", plate: "1234 LKM", title: "JB-2026-00017", subtitle: "Pedro Ruiz Martín", starts_at: "2026-11-07T16:00:00Z", ends_at: "2026-11-10T16:00:00Z", all_day: false, status: "reservation" },
    { kind: "rental", id: "r5", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002", plate: "5678 MNB", title: "JB-2026-00018", subtitle: "Lucía Fernández", starts_at: "2026-11-14T09:00:00Z", ends_at: "2026-11-21T09:00:00Z", all_day: false, status: "confirmed" },
    { kind: "rental", id: "r6", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000003", plate: "9012 PQR", title: "JB-2026-00012", subtitle: "Ana Torres", starts_at: "2026-10-27T09:00:00Z", ends_at: "2026-10-31T18:00:00Z", all_day: false, status: "completed" },
    { kind: "maintenance", id: "66660000-0000-4000-8000-000000000001", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002", plate: "5678 MNB", title: "Cambio de aceite y filtros", subtitle: "Talleres Sur", starts_at: "2026-11-04T23:00:00Z", ends_at: "2026-11-06T23:00:00Z", all_day: true, status: "scheduled" },
    { kind: "insurance_end", id: "33330000-0000-4000-8000-000000000002", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000003", plate: "9012 PQR", title: "Mutua Madrileña · MM-778120", subtitle: "", starts_at: "2026-11-08T23:00:00Z", ends_at: "2026-11-09T23:00:00Z", all_day: true, status: "open" },
    { kind: "itv", id: "aaaaaaaa-0000-0000-0000-000000000002", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002", plate: "5678 MNB", title: "Seat Ibiza", subtitle: "", starts_at: "2026-11-23T23:00:00Z", ends_at: "2026-11-24T23:00:00Z", all_day: true, status: "open" },
    { kind: "fine_deadline", id: "77770000-0000-4000-8000-000000000001", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", plate: "1234 LKM", title: "DGT · M-2026/118842", subtitle: "identification", starts_at: "2026-11-05T23:00:00Z", ends_at: "2026-11-06T23:00:00Z", all_day: true, status: "pending" },
  ],
  available_vehicles: [
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002", label: "Seat Ibiza 1.0 TSI FR", plate: "5678 MNB", category: "Económico", daily_price: 35, status: "available", available: true, conflict_contract: null, maintenance_conflict: true, insured: true },
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000003", label: "Kia Sportage 1.6 T-GDi MHEV", plate: "9012 PQR", category: "SUV", daily_price: 62, status: "reserved", available: true, conflict_contract: null, maintenance_conflict: false, insured: false },
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", label: "Toyota Corolla 1.8 Hybrid Active Tech", plate: "1234 LKM", category: "Compacto", daily_price: 45, status: "rented", available: false, conflict_contract: "JB-2026-00017", maintenance_conflict: false, insured: true },
  ],
  portal_me: { customer_id: "cccccccc-0000-0000-0000-000000000001", name: "Maria García López", customer_type: "individual", email: "maria.garcia@example.es", phone: "+34 611 22 33 44", driving_licence_expiry: "2026-11-28", company: { name: "JB RENT S.L.", legal_name: "JB Rent Sociedad Limitada", phone: "+34 910 000 000", email: "info@jbrent.es", address: "Calle de Alcalá, 100", city: "Madrid", default_locale: "es-ES" } },
  portal_rentals: [
    { id: "eeeeeeee-0000-0000-0000-000000000001", contract_number: "JB-2026-00015", status: "in_progress", pickup_at: "2026-11-01T09:00:00Z", return_at: "2026-11-05T09:00:00Z", actual_return_at: null, vehicle: "Toyota Corolla", plate: "1234 LKM", pickup_location: "Aeropuerto Madrid-Barajas T4", return_location: "Oficina Calle de Alcalá, 100", total_amount: 226, paid: 200, balance: 26, deposit_amount: 300, deposit_status: "held", deposit_balance: 300, signature_status: "signed", contract_locale: "es-ES" },
    { id: "r9", contract_number: "JB-2026-00021", status: "confirmed", pickup_at: "2026-12-20T09:00:00Z", return_at: "2026-12-27T09:00:00Z", actual_return_at: null, vehicle: "Kia Sportage", plate: "9012 PQR", pickup_location: "Oficina Calle de Alcalá, 100", return_location: null, total_amount: 434, paid: 100, balance: 334, deposit_amount: 300, deposit_status: "not_received", deposit_balance: 0, signature_status: "unsigned", contract_locale: "es-ES" },
    { id: "r2", contract_number: "JB-2026-00009", status: "completed", pickup_at: "2026-09-12T08:00:00Z", return_at: "2026-09-19T08:00:00Z", actual_return_at: "2026-09-19T07:40:00Z", vehicle: "Seat Ibiza", plate: "5678 MNB", pickup_location: null, return_location: null, total_amount: 270, paid: 270, balance: 0, deposit_amount: 300, deposit_status: "settled", deposit_balance: 0, signature_status: "signed", contract_locale: "es-ES" },
  ],
  portal_rental_payments: [{ kind: "payment", amount: 100, paid_at: "2026-10-28", method: "bizum" }, { kind: "payment", amount: 100, paid_at: "2026-11-01", method: "card" }],
  portal_documents: [
    { kind: "rental-doc", id: "d12", title: "Contrato firmado JB-2026-00015", category: "contract", expires_at: null, created_at: "2026-11-01T09:20:00Z", contract_number: "JB-2026-00015" },
    { kind: "customer-doc", id: "cd1", title: "DNI (anverso y reverso)", category: "id_document", expires_at: "2030-04-12", created_at: "2026-03-02T09:35:00Z", contract_number: null },
    { kind: "customer-doc", id: "cd2", title: "Permiso de conducir", category: "driving_licence", expires_at: "2026-11-28", created_at: "2026-03-02T09:36:00Z", contract_number: null },
  ],
  portal_fines: [
    { kind: "fine", id: "77770000-0000-4000-8000-000000000002", occurred_at: "2026-09-15T09:20:00Z", description: "Estacionamiento en zona SER sin ticket · Ayuntamiento de Madrid", plate: "5678 MNB", contract_number: "JB-2026-00009", status: "paid", amount: 90, charged: 65, charged_paid_at: null },
    { kind: "accident", id: "88880000-0000-4000-8000-000000000001", occurred_at: "2026-11-02T18:10:00Z", description: "Alcance trasero en retención", plate: "1234 LKM", contract_number: "JB-2026-00015", status: "reported", amount: null, charged: 300, charged_paid_at: null },
  ],
  portal_requests: [{ id: "rq1", pickup_at: "2027-01-15T09:00:00Z", return_at: "2027-01-19T09:00:00Z", vehicle_preference: "SUV automático", notes: null, status: "contacted", created_at: "2026-11-02T20:00:00Z" }],
  finance_report: { income: 6120.5, expenses: 1840.15, result: 4280.35,
    by_category: [{ type: "income", category: "rental", total: 5480 }, { type: "income", category: "additional_fee", total: 365.5 }, { type: "income", category: "excess_mileage", total: 210 }, { type: "income", category: "fine_recharge", total: 65 }, { type: "expense", category: "insurance", total: 685.4 }, { type: "expense", category: "repairs", total: 410 }, { type: "expense", category: "maintenance", total: 245.5 }, { type: "expense", category: "cleaning", total: 180 }, { type: "expense", category: "fuel", total: 154.25 }, { type: "expense", category: "fines", total: 45 }, { type: "expense", category: "other_expense", total: 120 }],
    non_operational: [{ type: "income", category: "loan_received", total: 20000 }, { type: "expense", category: "vehicle_purchase", total: 31900 }, { type: "expense", category: "loan_repayment", total: 612.4 }] },
  cash_flow: months.slice(0, 12).map((m, i) => ({ month: m, inflow: 2600 + i * 240, outflow: 1300 + (i % 4) * 300, net: 1300 + i * 240 - (i % 4) * 300, balance: 8000 + i * 1100, projected_in: i >= 11 ? 1480 : 0, projected_out: i >= 11 ? 920 : 0, deposits_in: 300 * (i % 3), deposits_out: 300 * ((i + 1) % 3) })).concat([1, 2, 3].map((k) => ({ month: ["2026-12-01", "2027-01-01", "2027-02-01"][k - 1], inflow: 0, outflow: 0, net: 0, balance: 20100, projected_in: [950, 420, 0][k - 1], projected_out: [612.4, 612.4, 612.4][k - 1], deposits_in: 0, deposits_out: 0 }))),
  open_items: [
    { kind: "rental", id: "eeeeeeee-0000-0000-0000-000000000001", description: "JB-2026-00015", category: "rental", amount: 26, due_date: "2026-11-01", vehicle_id: "a", plate: "1234 LKM", customer_id: "c", customer: "Maria García López", rental_id: "eeeeeeee-0000-0000-0000-000000000001", installment_no: null, installment_count: null },
    { kind: "entry", id: "99990000-0000-4000-8000-000000000011", description: "Repasse multa SER-55120", category: "fine_recharge", amount: 65, due_date: "2026-11-08", vehicle_id: "b", plate: "5678 MNB", customer_id: "c", customer: "Maria García López", rental_id: null, installment_no: null, installment_count: null },
    { kind: "entry", id: "99990000-0000-4000-8000-000000000012", description: "Franquicia · 1234 LKM", category: "damage_recovery", amount: 300, due_date: null, vehicle_id: "a", plate: "1234 LKM", customer_id: "c", customer: "Maria García López", rental_id: null, installment_no: null, installment_count: null },
  ],
  fleet_roi: [
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", label: "Toyota Corolla", plate: "1234 LKM", status: "rented", acquisition_date: "2026-01-10", purchase_price: 24500, current_value: 22100, sold_at: null, sale_price: null, revenue: 6250, expenses: 1180.4, profit: 5069.6, months_in_fleet: 9.6, rented_days: 186, available_days: 293 },
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002", label: "Seat Ibiza", plate: "5678 MNB", status: "available", acquisition_date: "2026-01-10", purchase_price: 16800, current_value: 14900, sold_at: null, sale_price: null, revenue: 4120, expenses: 1490.9, profit: 2629.1, months_in_fleet: 9.6, rented_days: 141, available_days: 293 },
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000003", label: "Kia Sportage", plate: "9012 PQR", status: "reserved", acquisition_date: "2026-01-10", purchase_price: 31900, current_value: 30400, sold_at: null, sale_price: null, revenue: 1490.5, expenses: 1095.55, profit: 394.95, months_in_fleet: 9.6, rented_days: 48, available_days: 293 },
    { vehicle_id: "aaaaaaaa-0000-0000-0000-000000000009", label: "Renault Clio", plate: "4455 KLM", status: "sold", acquisition_date: "2023-03-01", purchase_price: 14500, current_value: 9800, sold_at: "2026-06-30", sale_price: 9800, revenue: 15890, expenses: 4210.3, profit: 11679.7, months_in_fleet: 40, rented_days: 812, available_days: 1218 },
  ],
  maintenance_overview: { in_progress: 1, scheduled: 2, overdue: 1, due_soon: 1, cost_year: 287.4 },
  maintenance_due: [
    { plan_id: "55550000-0000-4000-8000-000000000004", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", vehicle: "Toyota Corolla · 1234 LKM", name: "Correa de distribución", maintenance_type: "preventive", next_date: "2026-10-15", next_km: null, current_km: 18450, days_left: -19, km_left: null, due_status: "overdue" },
    { plan_id: "55550000-0000-4000-8000-000000000001", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000002", vehicle: "Seat Ibiza · 5678 MNB", name: "Cambio de aceite y filtros", maintenance_type: "oil_change", next_date: "2026-11-20", next_km: 32000, current_km: 31200, days_left: 17, km_left: 800, due_status: "due_soon" },
    { plan_id: "55550000-0000-4000-8000-000000000002", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", vehicle: "Toyota Corolla · 1234 LKM", name: "Revisión oficial", maintenance_type: "preventive", next_date: "2027-09-11", next_km: 30020, current_km: 18450, days_left: 312, km_left: 11570, due_status: "ok" },
    { plan_id: "55550000-0000-4000-8000-000000000003", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000003", vehicle: "Kia Sportage · 9012 PQR", name: "Neumáticos", maintenance_type: "tyres", next_date: null, next_km: 40000, current_km: 6200, days_left: null, km_left: 33800, due_status: "ok" },
  ],
  insurance_overview: { active: 3, expiring: 2, expired: 0, uninsured_vehicles: 0, premiums_year: 1240 },
  extra_alert_rows: [{ kind: "fine_identification_due", severity: "high", entity: "traffic_fines", entity_id: "77770000-0000-4000-8000-000000000001", title: "DGT · M-2026/118842 · 1234 LKM", due_date: "2026-11-06" }, { kind: "accident_unreported", severity: "high", entity: "accidents", entity_id: "88880000-0000-4000-8000-000000000001", title: "Toyota Corolla · 1234 LKM", due_date: "2026-11-02" }, { kind: "maintenance_overdue", severity: "high", entity: "vehicles", entity_id: "aaaaaaaa-0000-0000-0000-000000000001", title: "Correa de distribución · Toyota Corolla · 1234 LKM", due_date: "2026-10-15" },{ kind: "document_expiring", severity: "low", entity: "customer_documents", entity_id: "cccccccc-0000-0000-0000-000000000002", title: "Permiso de conducir · Pedro Ruiz Martín", due_date: "2026-11-20" }],
  dashboard_alerts: [
    { kind: "rental_overdue", severity: "critical", entity: "rentals", entity_id: "1", title: "JB-2026-00014 · 5678 MNB", due_date: "2026-11-02" },
    { kind: "insurance_expiring", severity: "high", entity: "insurance_policies", entity_id: "2", title: "Mapfre · 9012 PQR", due_date: "2026-11-09" },
    { kind: "rental_return_soon", severity: "info", entity: "rentals", entity_id: "3", title: "JB-2026-00015 · 1234 LKM", due_date: "2026-11-05" },
    { kind: "itv_expiring", severity: "medium", entity: "vehicles", entity_id: "4", title: "Seat Ibiza · 5678 MNB", due_date: "2026-11-24" },
  ],
};
const profile = { id: user.id, email: user.email, full_name: "João Bartolomeu", role: "owner", company_id: "c1", locale: "pt-BR", is_active: true, last_sign_in_at: "2026-11-03T08:12:00Z", companies: { name: "JB RENT S.L." } };

const users = [
  profile,
  { id: "22222222-2222-2222-2222-222222222222", email: "maria@jbrent.es", full_name: "María García", phone: null, role: "admin", is_active: true, last_sign_in_at: "2026-11-02T17:40:00Z", created_at: "2026-02-01T10:00:00Z" },
  { id: "33333333-3333-3333-3333-333333333333", email: "contable@jbrent.es", full_name: "Gestoría López", phone: null, role: "admin", is_active: true, last_sign_in_at: null, created_at: "2026-11-01T10:00:00Z" },
];
const company = { id: "c1", name: "JB RENT S.L.", legal_name: "JB Rent Sociedad Limitada", tax_id: "B12345678", address: "Calle de Alcalá, 100", city: "Madrid", postal_code: "28009", province: "Madrid", phone: "+34 910 000 000", email: "info@jbrent.es", website: "jbrent.es", logo_path: null, default_locale: "es-ES", currency: "EUR", timezone: "Europe/Madrid", vat_rate: 21, prices_include_vat: true, iban: null, fiscal_notes: null, document_retention_years: 6, cash_opening_balance: 8000, cash_opening_date: "2025-12-01", default_daily_price: 45, default_weekly_price: 270, default_monthly_price: 950, default_deposit_amount: 300, default_mileage_policy: "daily", default_mileage_limit_km: 300, default_excess_km_price: 0.25, rental_conditions_pt: null, rental_conditions_es: null, contract_footer: null };
const fees = [
  { id: "ffffffff-0000-4000-8000-000000000001", name_pt: "Condutor adicional", name_es: "Conductor adicional", amount: 6.5, charge_type: "per_day", vat_rate: 21, is_active: true },
  { id: "ffffffff-0000-4000-8000-000000000002", name_pt: "Cadeirinha infantil", name_es: "Silla infantil", amount: 5, charge_type: "per_day", vat_rate: null, is_active: true },
  { id: "ffffffff-0000-4000-8000-000000000003", name_pt: "Entrega no aeroporto", name_es: "Entrega en aeropuerto", amount: 30, charge_type: "per_rental", vat_rate: 21, is_active: false },
];
const logs = [
  { id: 9, created_at: "2026-11-03T08:12:00Z", user_id: profile.id, action: "auth.login", entity: "auth", entity_id: profile.id, changes: null, ip_address: "83.45.12.9", user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15" },
  { id: 8, created_at: "2026-11-02T18:02:00Z", user_id: "22222222-2222-2222-2222-222222222222", action: "update", entity: "companies", entity_id: "c1", changes: { vat_rate: { old: null, new: 21 }, default_daily_price: { old: 40, new: 45 } }, ip_address: null, user_agent: null },
  { id: 7, created_at: "2026-11-01T10:00:00Z", user_id: profile.id, action: "user.invite", entity: "profiles", entity_id: "3333", changes: { email: "contable@jbrent.es", role: "admin" }, ip_address: null, user_agent: null },
  { id: 6, created_at: "2026-11-01T09:58:00Z", user_id: profile.id, action: "insert", entity: "fee_catalog", entity_id: "f1", changes: { name_pt: "Condutor adicional", name_es: "Conductor adicional", amount: 6.5, charge_type: "per_day" }, ip_address: null, user_agent: null },
];
const C = "c1";
const V1 = "aaaaaaaa-0000-0000-0000-000000000001", V2 = "aaaaaaaa-0000-0000-0000-000000000002", V3 = "aaaaaaaa-0000-0000-0000-000000000003";
const vBase = { vin: null, color: null, vehicle_type: null, doors: 5, seats: 5, acquisition_date: "2026-01-10", fleet_entry_date: "2026-01-15", weekly_price: 270, monthly_price: 950, notes: null, archived_at: null, created_at: "2026-01-15T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", company_id: C };
const vehicles = [
  { ...vBase, id: V1, brand: "Toyota", model: "Corolla", version: "1.8 Hybrid Active Tech", year: 2024, plate: "1234 LKM", vin: "JTDKB20U093123456", color: "Gris plata", vehicle_type: "sedan", fuel: "hybrid", transmission: "automatic", status: "rented", current_mileage: 18450, daily_price: 45, itv_due_date: "2028-01-15", category: "Compacto", purchase_price: 24500, market_value: 22100, main_photo_path: `${C}/vehicles/${V1}/photos/corolla.jpg` },
  { ...vBase, id: V2, brand: "Seat", model: "Ibiza", version: "1.0 TSI FR", year: 2023, plate: "5678 MNB", color: "Rojo", vehicle_type: "compact", fuel: "gasoline", transmission: "manual", status: "available", current_mileage: 31200, daily_price: 35, itv_due_date: "2026-11-24", category: "Económico", purchase_price: 16800, market_value: 14900, main_photo_path: `${C}/vehicles/${V2}/photos/ibiza.jpg` },
  { ...vBase, id: V3, brand: "Kia", model: "Sportage", version: "1.6 T-GDi MHEV", year: 2025, plate: "9012 PQR", color: "Blanco", vehicle_type: "suv", fuel: "hybrid", transmission: "automatic", status: "reserved", current_mileage: 6200, daily_price: 62, itv_due_date: "2029-03-01", category: "SUV", purchase_price: 31900, market_value: 30400, main_photo_path: `${C}/vehicles/${V3}/photos/sportage.jpg` },
];
const photos = [
  { id: "p1", vehicle_id: V1, kind: "main", caption: null, storage_path: `${C}/vehicles/${V1}/photos/corolla.jpg`, created_at: "2026-01-15T10:00:00Z" },
  { id: "p2", vehicle_id: V1, kind: "exterior", caption: null, storage_path: `${C}/vehicles/${V1}/photos/sportage.jpg`, created_at: "2026-01-15T10:00:00Z" },
  { id: "p3", vehicle_id: V1, kind: "interior", caption: null, storage_path: `${C}/vehicles/${V1}/photos/interior.jpg`, created_at: "2026-01-15T10:00:00Z" },
  { id: "p4", vehicle_id: V1, kind: "detail", caption: null, storage_path: `${C}/vehicles/${V1}/photos/detail.jpg`, created_at: "2026-01-15T10:00:00Z" },
];
const vdocs = [
  { id: "d1", category: "circulation_permit", title: "Permiso de circulación", mime_type: "application/pdf", size_bytes: 412000, issued_at: "2026-01-12", expires_at: null, created_at: "2026-01-15T10:00:00Z" },
  { id: "d2", category: "technical_sheet", title: "Ficha técnica", mime_type: "application/pdf", size_bytes: 985000, issued_at: "2026-01-12", expires_at: null, created_at: "2026-01-15T10:00:00Z" },
  { id: "d3", category: "itv", title: "ITV", mime_type: "image/jpeg", size_bytes: 1650000, issued_at: "2026-01-10", expires_at: "2028-01-15", created_at: "2026-01-15T10:00:00Z" },
];
const custBase = { birth_date: null, nationality: null, driving_licence_number: null, legal_name: null, representative_name: null, billing_details: {}, address: null, postal_code: null, country: "ES", notes: null, gdpr_consent_at: "2026-03-02T09:30:00Z", marketing_consent: false, created_at: "2026-03-02T09:30:00Z", archived_at: null, anonymized_at: null, tax_id: null, company_name: null, full_name: null, id_document_type: null, id_document_number: null, driving_licence_expiry: null, city: null };
const customers = [
  { ...custBase, id: "cccccccc-0000-0000-0000-000000000001", customer_type: "individual", full_name: "Maria García López", birth_date: "1988-04-12", nationality: "ES", id_document_type: "dni", id_document_number: "12345678Z", driving_licence_number: "12345678Z", driving_licence_expiry: "2031-06-30", phone: "+34 611 22 33 44", email: "maria.garcia@example.es", address: "Calle Mayor, 15, 3º B", postal_code: "28013", city: "Madrid", marketing_consent: true },
  { ...custBase, id: "cccccccc-0000-0000-0000-000000000002", customer_type: "individual", full_name: "Pedro Ruiz Martín", id_document_type: "nie", id_document_number: "X1234567L", driving_licence_expiry: "2026-11-20", phone: "+34 622 98 76 54", email: "pedro.ruiz@example.es", city: "Alcobendas" },
  { ...custBase, id: "cccccccc-0000-0000-0000-000000000003", customer_type: "company", company_name: "Transportes Sol S.L.", legal_name: "Transportes Sol Sociedad Limitada", tax_id: "B87654321", representative_name: "Ana Sol", billing_details: { email: "facturas@transportessol.es", address: "Polígono Las Mercedes, nave 4, 28022 Madrid" }, phone: "+34 913 00 11 22", email: "info@transportessol.es", city: "Madrid" },
];
const cdocs = [
  { id: "cd1", doc_type: "id_document", title: "DNI (anverso y reverso)", mime_type: "application/pdf", size_bytes: 520000, expires_at: "2030-04-12", created_at: "2026-03-02T09:35:00Z", retention_until: "2032-03-02", customer_id: "cccccccc-0000-0000-0000-000000000001", customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" } },
  { id: "cd2", doc_type: "driving_licence", title: "Permiso de conducir", mime_type: "image/jpeg", size_bytes: 1320000, expires_at: "2031-06-30", created_at: "2026-03-02T09:36:00Z", retention_until: "2032-03-02", customer_id: "cccccccc-0000-0000-0000-000000000001", customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" } },
  { id: "cd3", doc_type: "driving_licence", title: "Permiso de conducir", mime_type: "image/jpeg", size_bytes: 980000, expires_at: "2026-11-20", created_at: "2026-05-10T09:36:00Z", retention_until: "2032-05-10", customer_id: "cccccccc-0000-0000-0000-000000000002", customers: { full_name: "Pedro Ruiz Martín", company_name: null, customer_type: "individual" } },
];
const vrentals = [
  { id: "r1", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001", contract_number: "JB-2026-00015", status: "in_progress", pickup_at: "2026-11-01T09:00:00Z", return_at: "2026-11-05T09:00:00Z", total_amount: 180, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" }, vehicles: { brand: "Toyota", model: "Corolla", plate: "1234 LKM" } },
  { id: "r2", contract_number: "JB-2026-00009", status: "completed", pickup_at: "2026-09-12T08:00:00Z", return_at: "2026-09-19T08:00:00Z", total_amount: 270, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" }, vehicles: { brand: "Seat", model: "Ibiza", plate: "5678 MNB" } },
];
const vHistory = [
  { id: 30, created_at: "2026-11-01T09:05:00Z", user_id: "11111111-1111-1111-1111-111111111111", action: "update", entity: "vehicles", entity_id: V1, changes: { status: { old: "available", new: "rented" }, current_mileage: { old: 18210, new: 18450 } }, ip_address: null, user_agent: null },
  { id: 12, created_at: "2026-01-15T10:00:00Z", user_id: "22222222-2222-2222-2222-222222222222", action: "insert", entity: "vehicles", entity_id: V1, changes: { brand: "Toyota", model: "Corolla", plate: "1234 LKM" }, ip_address: null, user_agent: null },
];

const RID = "eeeeeeee-0000-0000-0000-000000000001";
const rentalDetail = {
  id: RID, company_id: "c1", contract_number: "JB-2026-00015", status: "in_progress", customer_id: "cccccccc-0000-0000-0000-000000000001", vehicle_id: "aaaaaaaa-0000-0000-0000-000000000001",
  pickup_at: "2026-11-01T09:00:00Z", return_at: "2026-11-05T09:00:00Z", actual_return_at: null, picked_up_at: "2026-11-01T09:12:00Z",
  pricing_mode: "daily", unit_price: 45, rental_days: 4, base_amount: 180, extras_amount: 56, extra_fees_amount: 0, discount_amount: 10,
  excess_km: 0, excess_mileage_amount: 0, total_amount: 226, deposit_amount: 300, payment_method: "card", mileage_policy: "daily",
  mileage_limit_km: 250, allowed_km: 1000, excess_km_price: 0.25, start_mileage: 18210, end_mileage: null, start_fuel_level: 100, end_fuel_level: null,
  contract_locale: "es-ES", signature_status: "unsigned", pickup_location: "Aeropuerto Madrid-Barajas T4", return_location: "Oficina Calle de Alcalá, 100",
  notes: "Cliente solicita silla infantil instalada.", return_notes: null, cancelled_reason: null, created_at: "2026-10-28T16:20:00Z", archived_at: null,
  customers: { id: "cccccccc-0000-0000-0000-000000000001", customer_type: "individual", full_name: "Maria García López", company_name: null, legal_name: null, id_document_type: "dni", id_document_number: "12345678Z", tax_id: null, driving_licence_number: "12345678Z", driving_licence_expiry: "2031-06-30", address: "Calle Mayor, 15, 3º B", postal_code: "28013", city: "Madrid", country: "ES", phone: "+34 611 22 33 44", email: "maria.garcia@example.es", representative_name: null },
  vehicles: { id: "aaaaaaaa-0000-0000-0000-000000000001", brand: "Toyota", model: "Corolla", version: "1.8 Hybrid Active Tech", plate: "1234 LKM", vin: "JTDKB20U093123456", color: "Gris plata", current_mileage: 18210, daily_price: 45, year: 2024 },
  rental_extras: [{ id: "x1", fee_id: "f1", name: "Conductor adicional", amount: 6.5, charge_type: "per_day", quantity: 1 }, { id: "x2", fee_id: "f2", name: "Silla infantil", amount: 5, charge_type: "per_day", quantity: 1 }, { id: "x3", fee_id: null, name: "Entrega en aeropuerto", amount: 10, charge_type: "per_rental", quantity: 1 }],
  rental_payments: [
    { id: "pay1", kind: "payment", amount: 100, paid_at: "2026-10-28", method: "bizum", reference: null, voided_at: null, void_reason: null, created_at: "2026-10-28T16:30:00Z" },
    { id: "pay2", kind: "payment", amount: 100, paid_at: "2026-11-01", method: "card", reference: "TPV 004512", voided_at: "2026-11-01T09:20:00Z", void_reason: "Cobro duplicado en el TPV", created_at: "2026-11-01T09:15:00Z" },
    { id: "pay3", kind: "payment", amount: 100, paid_at: "2026-11-01", method: "card", reference: "TPV 004513", voided_at: null, void_reason: null, created_at: "2026-11-01T09:21:00Z" },
  ],
  deposits: { id: "dep1", amount_received: 300, received_at: "2026-11-01", received_method: "card", amount_returned: 0, returned_at: null, returned_method: null, amount_retained: 0, retention_reason: null, status: "held", balance: 300 },
};
const depositsList = [
  { id: "dep1", rental_id: RID, amount_received: 300, amount_returned: 0, amount_retained: 0, balance: 300, status: "held", received_at: "2026-11-01", returned_at: null, retention_reason: null, rentals: { contract_number: "JB-2026-00015", deposit_amount: 300, status: "in_progress", return_at: "2026-11-05T09:00:00Z" }, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" }, vehicles: { plate: "1234 LKM" } },
  { id: "dep2", rental_id: "r2", amount_received: 300, amount_returned: 250, amount_retained: 50, balance: 0, status: "settled", received_at: "2026-09-12", returned_at: "2026-09-19", retention_reason: "Limpieza interior", rentals: { contract_number: "JB-2026-00009", deposit_amount: 300, status: "completed", return_at: "2026-09-19T08:00:00Z" }, customers: { full_name: "Pedro Ruiz Martín", company_name: null, customer_type: "individual" }, vehicles: { plate: "5678 MNB" } },
];

const V = "aaaaaaaa-0000-0000-0000-000000000001";
const ph = (id, insp, area, file) => ({ id, area, storage_path: `c1/vehicles/${V}/inspections/${insp}/${file}`, created_at: "2026-11-01T09:0" + id.slice(-1) + ":00Z" });
const vehRef = { id: V, brand: "Toyota", model: "Corolla", plate: "1234 LKM", current_mileage: 18210 };
const rentRef = { id: "eeeeeeee-0000-0000-0000-000000000001", contract_number: "JB-2026-00015", status: "in_progress", start_mileage: 18210, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" } };
const DEL = "11110000-0000-4000-8000-000000000001", RET = "11110000-0000-4000-8000-000000000002", DRAFT = "11110000-0000-4000-8000-000000000003";
const inspBase = { vehicle_id: V, rental_id: rentRef.id, customer_present: true, customer_name: "Maria García López", existing_damages_confirmed: true, completed_by: "11111111-1111-1111-1111-111111111111", created_by: "11111111-1111-1111-1111-111111111111", vehicles: vehRef, rentals: rentRef };
const inspections = {
  [DEL]: { ...inspBase, id: DEL, inspection_type: "delivery", status: "completed", performed_at: "2026-11-01T09:00:00Z", completed_at: "2026-11-01T09:12:00Z", mileage: 18210, fuel_level: 100, observations: "Vehículo limpio, depósito lleno.", checklist: { front: { condition: "ok" }, rear: { condition: "ok" }, left_side: { condition: "minor", notes: "Arañazo leve en puerta trasera" }, right_side: { condition: "ok" }, glass: { condition: "ok" }, lights: { condition: "ok" }, wheels_tyres: { condition: "ok" }, interior: { condition: "ok" }, dashboard: { condition: "ok" }, trunk: { condition: "ok" }, safety_kit: { condition: "ok" } }, inspection_photos: [ph("ip1", DEL, "front", "sportage.jpg"), ph("ip2", DEL, "left_side", "corolla.jpg"), ph("ip3", DEL, "interior", "interior.jpg")] },
  [RET]: { ...inspBase, id: RET, inspection_type: "return", status: "completed", performed_at: "2026-11-05T09:00:00Z", completed_at: "2026-11-05T09:18:00Z", mileage: 19480, fuel_level: 75, observations: null, checklist: { front: { condition: "damaged", notes: "Abolladura en el paragolpes delantero" }, rear: { condition: "ok" }, left_side: { condition: "minor", notes: "Arañazo leve en puerta trasera" }, right_side: { condition: "ok" }, glass: { condition: "ok" }, lights: { condition: "ok" }, wheels_tyres: { condition: "ok" }, interior: { condition: "minor", notes: "Mancha en asiento trasero" }, dashboard: { condition: "ok" }, trunk: { condition: "ok" }, safety_kit: { condition: "ok" } }, inspection_photos: [ph("ip4", RET, "front", "detail.jpg"), ph("ip5", RET, "interior", "interior.jpg")] },
  [DRAFT]: { ...inspBase, id: DRAFT, rental_id: null, rentals: null, inspection_type: "periodic", status: "draft", performed_at: "2026-11-03T10:00:00Z", completed_at: null, completed_by: null, mileage: 19480, fuel_level: null, observations: null, existing_damages_confirmed: false, checklist: { front: { condition: "damaged", notes: "Abolladura pendiente de reparar" }, rear: { condition: "ok" } }, inspection_photos: [ph("ip6", DRAFT, "front", "detail.jpg")] },
};

const vRef = (id) => { const v = vehicles.find((x) => x.id === id); return { id: v.id, brand: v.brand, model: v.model, plate: v.plate }; };
const pBase = { coverage_type: "Todo riesgo con franquicia", deductible_amount: 300, roadside_assistance: true, assistance_phone: "+34 900 822 822", paid_at: null, payment_method: null, renewed_from_id: null, notes: null, archived_at: null, created_at: "2026-01-15T10:00:00Z" };
const policies = [
  { ...pBase, id: "33330000-0000-4000-8000-000000000001", vehicle_id: V1, insurer: "Mapfre", policy_number: "MP-0045821", start_date: "2026-01-15", end_date: "2027-01-14", premium_amount: 1240, paid_at: "2026-01-15", payment_method: "direct_debit", renewed_from_id: "33330000-0000-4000-8000-000000000004", vehicles: null },
  { ...pBase, id: "33330000-0000-4000-8000-000000000002", vehicle_id: V3, insurer: "Mutua Madrileña", policy_number: "MM-778120", coverage_type: "Terceros ampliado", start_date: "2025-11-10", end_date: "2026-11-09", premium_amount: 685.4, deductible_amount: null, vehicles: null },
  { ...pBase, id: "33330000-0000-4000-8000-000000000003", vehicle_id: V2, insurer: "Allianz", policy_number: "AZ-55120-B", start_date: "2025-11-20", end_date: "2026-11-19", premium_amount: 540, paid_at: "2025-11-20", payment_method: "card", vehicles: null },
  { ...pBase, id: "33330000-0000-4000-8000-000000000004", vehicle_id: V1, insurer: "Mapfre", policy_number: "MP-0045821", start_date: "2025-01-15", end_date: "2026-01-14", premium_amount: 1180, paid_at: "2025-01-15", payment_method: "direct_debit", vehicles: null },
].map((p) => ({ ...p, vehicles: vRef(p.vehicle_id) }));
const centerDocs = [
  { id: "d10", category: "insurance_policy", title: "Póliza Mapfre 2026", mime_type: "application/pdf", size_bytes: 512000, issued_at: "2026-01-15", expires_at: "2027-01-14", retention_until: "2032-01-15", created_at: "2026-01-15T10:00:00Z", vehicle_id: V1, rental_id: null, insurance_policy_id: "33330000-0000-4000-8000-000000000001", vehicles: { plate: "1234 LKM" }, rentals: null, insurance_policies: { insurer: "Mapfre", policy_number: "MP-0045821" } },
  { id: "d11", category: "receipt", title: "Recibo prima Mapfre", mime_type: "application/pdf", size_bytes: 88000, issued_at: "2026-01-15", expires_at: null, retention_until: "2032-01-15", created_at: "2026-01-15T10:05:00Z", vehicle_id: V1, rental_id: null, insurance_policy_id: "33330000-0000-4000-8000-000000000001", vehicles: { plate: "1234 LKM" }, rentals: null, insurance_policies: { insurer: "Mapfre", policy_number: "MP-0045821" } },
  { id: "d12", category: "contract", title: "Contrato firmado JB-2026-00015", mime_type: "application/pdf", size_bytes: 1320000, issued_at: "2026-11-01", expires_at: null, retention_until: "2032-11-01", created_at: "2026-11-01T09:20:00Z", vehicle_id: null, rental_id: "eeeeeeee-0000-0000-0000-000000000001", insurance_policy_id: null, vehicles: null, rentals: { contract_number: "JB-2026-00015" }, insurance_policies: null },
  { id: "d13", category: "itv", title: "ITV Seat Ibiza", mime_type: "image/jpeg", size_bytes: 1650000, issued_at: "2024-11-24", expires_at: "2026-11-24", retention_until: "2030-11-24", created_at: "2024-11-24T10:00:00Z", vehicle_id: V2, rental_id: null, insurance_policy_id: null, vehicles: { plate: "5678 MNB" }, rentals: null, insurance_policies: null },
  { id: "d14", category: "invoice", title: "Factura compra Kia Sportage", mime_type: "application/pdf", size_bytes: 240000, issued_at: "2026-02-03", expires_at: null, retention_until: "2032-02-03", created_at: "2026-02-03T10:00:00Z", vehicle_id: null, rental_id: null, insurance_policy_id: null, vehicles: null, rentals: null, insurance_policies: null },
  { id: "d15", category: "receipt", title: "Recibos alquiler local 2019", mime_type: "application/pdf", size_bytes: 92000, issued_at: "2019-06-30", expires_at: null, retention_until: "2025-06-30", created_at: "2019-07-01T10:00:00Z", vehicle_id: null, rental_id: null, insurance_policy_id: null, vehicles: null, rentals: null, insurance_policies: null },
];

const vR = (id) => { const v = vehicles.find((x) => x.id === id); return { brand: v.brand, model: v.model, plate: v.plate, current_mileage: v.current_mileage }; };
const mBase = { plan_id: null, damage_id: null, description: null, started_at: null, completed_date: null, mileage: null, workshop: null, cost: null, invoice_number: null, paid_at: null, payment_method: null, blocks_vehicle: true, cancel_reason: null, notes: null, archived_at: null, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z", maintenance_plans: null, damages: null };
const MR1 = "66660000-0000-4000-8000-000000000001";
const mrecords = [
  { ...mBase, id: MR1, vehicle_id: V2, plan_id: "55550000-0000-4000-8000-000000000001", maintenance_type: "oil_change", status: "scheduled", title: "Cambio de aceite y filtros", scheduled_date: "2026-11-05", workshop: "Talleres Sur", cost: 189.9, maintenance_plans: { name: "Cambio de aceite y filtros" } },
  { ...mBase, id: "66660000-0000-4000-8000-000000000002", vehicle_id: V1, damage_id: "22220000-0000-4000-8000-000000000001", maintenance_type: "bodywork", status: "in_progress", title: "Reparación paragolpes delantero", scheduled_date: "2026-11-06", started_at: "2026-11-03", workshop: "Chapa Madrid", cost: 380, blocks_vehicle: false, damages: { description: "Abolladura en el paragolpes delantero", status: "in_repair" } },
  { ...mBase, id: "66660000-0000-4000-8000-000000000003", vehicle_id: V3, maintenance_type: "tyres", status: "scheduled", title: "Neumáticos", scheduled_date: "2026-10-30" },
  { ...mBase, id: "66660000-0000-4000-8000-000000000004", vehicle_id: V1, maintenance_type: "preventive", status: "completed", title: "Revisión 15.000 km", scheduled_date: "2026-09-10", started_at: "2026-09-10", completed_date: "2026-09-11", mileage: 15020, workshop: "Toyota Madrid Norte", cost: 245.5, invoice_number: "F-2026-1182", paid_at: "2026-09-11", payment_method: "card" },
  { ...mBase, id: "66660000-0000-4000-8000-000000000005", vehicle_id: V2, maintenance_type: "itv", status: "completed", title: "ITV", completed_date: "2026-06-02", mileage: 28400, workshop: "ITV Alcobendas", cost: 41.9 },
].map((r) => ({ ...r, vehicles: vR(r.vehicle_id) }));
const plansM = [
  { id: "55550000-0000-4000-8000-000000000001", vehicle_id: V2, name: "Cambio de aceite y filtros", maintenance_type: "oil_change", interval_km: 15000, interval_months: 12, last_done_date: "2025-11-20", last_done_mileage: 17000, notes: null },
  { id: "55550000-0000-4000-8000-000000000002", vehicle_id: V1, name: "Revisión oficial", maintenance_type: "preventive", interval_km: 15000, interval_months: 12, last_done_date: "2026-09-11", last_done_mileage: 15020, notes: null },
  { id: "55550000-0000-4000-8000-000000000003", vehicle_id: V3, name: "Neumáticos", maintenance_type: "tyres", interval_km: 40000, interval_months: null, last_done_date: null, last_done_mileage: 0, notes: null },
  { id: "55550000-0000-4000-8000-000000000004", vehicle_id: V1, name: "Correa de distribución", maintenance_type: "preventive", interval_km: null, interval_months: 24, last_done_date: "2024-10-15", last_done_mileage: null, notes: null },
];
const fBase = { rental_id: null, customer_id: null, reference: null, location: null, points: null, notified_at: null, identification_deadline: null, payment_deadline: null, status: "pending", identified_at: null, paid_at: null, paid_amount: null, payment_method: null, recharge_amount: null, recharge_paid_at: null, notes: null, archived_at: null, created_at: "2026-10-28T10:00:00Z", rentals: null, customers: null };
const finesM = [
  { ...fBase, id: "77770000-0000-4000-8000-000000000001", vehicle_id: V1, rental_id: RID, customer_id: "cccccccc-0000-0000-0000-000000000001", infraction_at: "2026-11-02T16:40:00Z", authority: "DGT", reference: "M-2026/118842", infraction: "Exceso de velocidad (radar fijo, 72 km/h en vía de 50)", location: "M-30, km 12", points: 2, amount: 100, notified_at: "2026-11-03", identification_deadline: "2026-11-06", payment_deadline: "2026-11-23", rentals: { contract_number: "JB-2026-00015" }, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" } },
  { ...fBase, id: "77770000-0000-4000-8000-000000000002", vehicle_id: V2, rental_id: "r2", customer_id: "cccccccc-0000-0000-0000-000000000001", infraction_at: "2026-09-15T09:20:00Z", authority: "Ayuntamiento de Madrid", reference: "SER-55120", infraction: "Estacionamiento en zona SER sin ticket", location: "Calle de Alcalá, 210", amount: 90, status: "paid", paid_at: "2026-10-01", paid_amount: 45, payment_method: "card", recharge_amount: 65, rentals: { contract_number: "JB-2026-00009" }, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" } },
  { ...fBase, id: "77770000-0000-4000-8000-000000000003", vehicle_id: V3, infraction_at: "2026-10-12T07:05:00Z", authority: "DGT", reference: "M-2026/099120", infraction: "Circular por carril bus", amount: 200, status: "driver_identified", identified_at: "2026-10-20", customer_id: "cccccccc-0000-0000-0000-000000000002", customers: { full_name: "Pedro Ruiz Martín", company_name: null, customer_type: "individual" } },
].map((r) => ({ ...r, vehicles: vR(r.vehicle_id) }));
const ACC = "88880000-0000-4000-8000-000000000001";
const accidentsM = [
  { id: ACC, vehicle_id: V1, rental_id: RID, customer_id: "cccccccc-0000-0000-0000-000000000001", insurance_policy_id: "33330000-0000-4000-8000-000000000001", occurred_at: "2026-11-02T18:10:00Z", location: "M-30, salida 7", description: "Alcance trasero en retención", status: "reported", fault: "third_party", injuries: false, third_party: true, third_party_details: "Renault Clio 4455 KLM · Línea Directa, póliza LD-88120", police_report: false, police_report_number: null, amicable_report: true, insurer_claim_number: null, reported_to_insurer_at: null, estimated_cost: 650, deductible_amount: 300, deductible_paid_at: null, insurer_payout: null, insurer_payout_at: null, closed_at: null, notes: null, archived_at: null, created_at: "2026-11-02T19:00:00Z", rentals: { contract_number: "JB-2026-00015" }, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" }, insurance_policies: { insurer: "Mapfre", policy_number: "MP-0045821", deductible_amount: 300, assistance_phone: "+34 900 822 822" }, accident_photos: [{ id: "ap1", storage_path: `c1/vehicles/${V1}/accidents/${ACC}/detail.jpg`, created_at: "2026-11-02T19:01:00Z" }, { id: "ap2", storage_path: `c1/vehicles/${V1}/accidents/${ACC}/corolla.jpg`, created_at: "2026-11-02T19:02:00Z" }] },
].map((r) => ({ ...r, vehicles: vR(r.vehicle_id) }));

const ftB = { vat_rate: null, due_date: null, paid_at: null, status: "paid", payment_method: null, vehicle_id: null, customer_id: null, rental_id: null, rental_line: null, source_ref: null, insurance_policy_id: null, series_id: null, installment_no: null, installment_count: null, reference: null, notes: null, is_operational: true, created_at: "2026-11-01T10:00:00Z", vehicles: null, rentals: null };
const ftList = [
  { ...ftB, id: "f01", type: "income", category: "rental", description: "JB-2026-00015 · 1234 LKM", amount: 170, competence_date: "2026-11-05", due_date: "2026-11-01", status: "pending", rental_id: RID, rental_line: "rental", vehicles: { plate: "1234 LKM" }, rentals: { contract_number: "JB-2026-00015" } },
  { ...ftB, id: "f02", type: "expense", category: "maintenance", description: "Cambio de aceite y filtros · 5678 MNB · Talleres Sur", amount: 189.9, competence_date: "2026-11-03", due_date: "2026-11-03", status: "pending", source_ref: "maintenance:66660000-0000-4000-8000-000000000001", vehicles: { plate: "5678 MNB" } },
  { ...ftB, id: "99990000-0000-4000-8000-000000000021", type: "expense", category: "loan_repayment", description: "Cuota préstamo Kia (2/24)", amount: 612.4, competence_date: "2026-11-10", due_date: "2026-11-10", status: "pending", is_operational: false, series_id: "s1", installment_no: 2, installment_count: 24, vehicle_id: V3, vehicles: { plate: "9012 PQR" } },
  { ...ftB, id: "99990000-0000-4000-8000-000000000022", type: "expense", category: "other_expense", description: "Alquiler plaza de garaje noviembre", amount: 120, competence_date: "2026-11-01", due_date: "2026-11-05", status: "pending" },
  { ...ftB, id: "f05", type: "expense", category: "fines", description: "Ayuntamiento de Madrid · SER-55120 · 5678 MNB", amount: 45, competence_date: "2026-09-15", paid_at: "2026-10-01", source_ref: "fine:77770000-0000-4000-8000-000000000002:expense", vehicles: { plate: "5678 MNB" } },
  { ...ftB, id: "f06", type: "income", category: "other_income", description: "Subarriendo plaza a vecino", amount: 80, competence_date: "2026-11-01", paid_at: "2026-11-02", payment_method: "bizum" },
  { ...ftB, id: "f07", type: "expense", category: "fuel", description: "Repostaje entrega aeropuerto", amount: 54.25, competence_date: "2026-11-01", status: "cancelled" },
];

const notifs = [
  { id: "n1", source: "event", kind: "rental_request", severity: "high", title: "Maria García López · 15/01/2027 → 19/01/2027", entity: "rental_requests", entity_id: "rq1", due_date: "2027-01-15", created_at: "2026-11-02T20:00:00Z", resolved_at: null, notification_reads: [] },
  { id: "n2", source: "alert", kind: "rental_overdue", severity: "critical", title: "JB-2026-00014 · 5678 MNB", entity: "rentals", entity_id: "eeeeeeee-0000-0000-0000-000000000001", due_date: "2026-11-02", created_at: "2026-11-02T10:05:00Z", resolved_at: null, notification_reads: [] },
  { id: "n3", source: "alert", kind: "fine_identification_due", severity: "high", title: "DGT · M-2026/118842 · 1234 LKM", entity: "traffic_fines", entity_id: "77770000-0000-4000-8000-000000000001", due_date: "2026-11-06", created_at: "2026-11-03T08:00:00Z", resolved_at: null, notification_reads: [] },
  { id: "n4", source: "alert", kind: "accident_unreported", severity: "high", title: "Toyota Corolla · 1234 LKM", entity: "accidents", entity_id: "88880000-0000-4000-8000-000000000001", due_date: "2026-11-02", created_at: "2026-11-02T19:00:00Z", resolved_at: null, notification_reads: [] },
  { id: "n5", source: "alert", kind: "insurance_expiring", severity: "high", title: "Mutua Madrileña · 9012 PQR", entity: "insurance_policies", entity_id: "33330000-0000-4000-8000-000000000002", due_date: "2026-11-09", created_at: "2026-10-10T08:00:00Z", resolved_at: null, notification_reads: [{ read_at: "2026-10-11T09:00:00Z" }] },
  { id: "n6", source: "alert", kind: "maintenance_scheduled", severity: "info", title: "Cambio de aceite y filtros · 5678 MNB", entity: "maintenance_records", entity_id: "66660000-0000-4000-8000-000000000001", due_date: "2026-11-05", created_at: "2026-11-02T08:00:00Z", resolved_at: null, notification_reads: [{ read_at: "2026-11-02T09:00:00Z" }] },
];
const requestsM = [
  { id: "rq2", customer_id: "cccccccc-0000-0000-0000-000000000002", pickup_at: "2026-12-04T08:00:00Z", return_at: "2026-12-08T19:00:00Z", vehicle_preference: "Compacto automático", notes: "Llegada en el vuelo IB3167", status: "new", rental_id: null, created_at: "2026-11-03T07:40:00Z", customers: { full_name: "Pedro Ruiz Martín", company_name: null, customer_type: "individual", phone: "+34 622 98 76 54", email: "pedro.ruiz@example.es" } },
  { id: "rq1", customer_id: "cccccccc-0000-0000-0000-000000000001", pickup_at: "2027-01-15T09:00:00Z", return_at: "2027-01-19T09:00:00Z", vehicle_preference: "SUV automático", notes: null, status: "contacted", rental_id: null, created_at: "2026-11-02T20:00:00Z", customers: { full_name: "Maria García López", company_name: null, customer_type: "individual", phone: "+34 611 22 33 44", email: "maria.garcia@example.es" } },
];
const DMG = "22220000-0000-4000-8000-000000000001";
const damagesData = [
  { id: DMG, vehicle_id: V, rental_id: rentRef.id, customer_id: "cccccccc-0000-0000-0000-000000000001", inspection_id: RET, detected_at: "2026-11-05", mileage: 19480, area: "front", category: "dent", severity: "high", status: "pending", description: "Abolladura en el paragolpes delantero", estimated_cost: 380, actual_cost: null, repair_shop: null, resolved_at: null, notes: null, created_at: "2026-11-05T09:25:00Z", vehicles: { brand: "Toyota", model: "Corolla", plate: "1234 LKM" }, rentals: { contract_number: "JB-2026-00015" }, customers: { full_name: "Maria García López", company_name: null, customer_type: "individual" }, damage_photos: [{ id: "dp1", storage_path: `c1/vehicles/${V}/damages/${DMG}/detail.jpg`, created_at: "2026-11-05T09:26:00Z" }] },
  { id: "22220000-0000-4000-8000-000000000002", vehicle_id: V, rental_id: null, customer_id: null, inspection_id: null, detected_at: "2026-08-20", mileage: 12100, area: "wheels_tyres", category: "tyres", severity: "medium", status: "resolved", description: "Pinchazo rueda trasera derecha", estimated_cost: 90, actual_cost: 74.5, repair_shop: "Neumáticos Sur", resolved_at: "2026-08-21", notes: null, created_at: "2026-08-20T09:25:00Z", vehicles: { brand: "Toyota", model: "Corolla", plate: "1234 LKM" }, rentals: null, customers: null, damage_photos: [] },
];

http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", req.headers.origin || "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] || "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-expose-headers", "content-range");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const u = new URL(req.url, "http://x"); const send = (s, o) => { res.writeHead(s, { "content-type": "application/json" }); res.end(o === undefined ? "" : JSON.stringify(o)); };
    if (process.env.MOCK_VERBOSE) console.log(req.method, u.pathname);
    if (u.pathname === "/auth/v1/token") { const p = JSON.parse(body || "{}"); return p.password === "SenhaForte123" || u.searchParams.get("grant_type") === "refresh_token" ? send(200, session) : send(400, { code: "invalid_credentials", message: "Invalid login credentials" }); }
    if (u.pathname === "/auth/v1/user") return (req.headers.authorization || "").includes(token) ? send(200, user) : send(401, { message: "no" });
    if (u.pathname === "/auth/v1/logout") return send(204);
    if (u.pathname.startsWith("/rest/v1/rpc/")) { const n = u.pathname.split("/").pop(); return n in rpc ? send(200, rpc[n]) : send(204); }
    const one = (req.headers.accept || "").includes("pgrst.object");
    if (req.method !== "GET" && u.pathname.startsWith("/rest/v1/") && !u.pathname.startsWith("/rest/v1/rpc/")) { console.log("WRITE", req.method, u.pathname, body.slice(0, 200)); res.writeHead(200, { "content-type": "application/json" }); const row = { id: u.pathname.endsWith("damages") ? DMG : u.pathname.endsWith("inspections") ? DRAFT : "x", rental_id: null, vehicle_id: V, inspection_id: DRAFT, damage_id: DMG, storage_path: "x" }; return res.end(JSON.stringify(one ? row : [row])); }
    const idEq = (u.searchParams.get("id") || "").replace(/^eq\./, "");
    const sendList = (rows) => { res.writeHead(200, { "content-type": "application/json", "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }); return res.end(JSON.stringify(rows)); };
    const pick = (rows) => { const r = rows.find((x) => x.id === idEq) || null; return one ? (r ? send(200, r) : send(406, { code: "PGRST116", message: "no rows" })) : send(200, r ? [r] : []); };
    if (u.pathname.startsWith("/storage/v1/object/documents/") && req.method === "POST") { console.log("UPLOAD", u.pathname, body.length); return send(200, { Key: u.pathname.replace("/storage/v1/object/", ""), Id: "obj1" }); }
    if (u.pathname === "/storage/v1/object/documents" && req.method === "DELETE") { console.log("STORAGE DELETE", body); return send(200, []); }
    if (u.pathname.startsWith("/storage/v1/object/sign/documents") && req.method === "POST") {
      const b = JSON.parse(body || "{}");
      if (b.paths) return send(200, b.paths.map((p) => ({ path: p, signedURL: `/object/sign/documents/${p}?token=x`, error: null })));
      const p = u.pathname.replace("/storage/v1/object/sign/documents/", "");
      return send(200, { signedURL: `/object/sign/documents/${p}?token=x` });
    }
    if (u.pathname.startsWith("/storage/v1/object/sign/documents/") && req.method === "GET") {
      const f = u.pathname.split("/").pop();
      const file = IMG_DIR + (fs.existsSync(IMG_DIR + f) ? f : "corolla.jpg");
      res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(fs.readFileSync(file));
    }
    if (u.pathname === "/rest/v1/vehicles") { if (idEq) return pick(vehicles); if ((u.searchParams.get("select") || "") === "status") return sendList(vehicles.map((v) => ({ status: v.status }))); return sendList(vehicles); }
    if (u.pathname === "/rest/v1/vehicle_photos") return sendList(photos.filter((p) => !u.searchParams.get("vehicle_id") || p.vehicle_id === u.searchParams.get("vehicle_id").slice(3)));
    if (u.pathname === "/rest/v1/documents") {
      const ip = (u.searchParams.get("insurance_policy_id") || "").replace("eq.", "");
      const rid = (u.searchParams.get("rental_id") || "").replace("eq.", "");
      if (ip) return sendList(centerDocs.filter((d) => d.insurance_policy_id === ip));
      if (u.searchParams.get("accident_id")) return sendList([{ id: "d20", category: "accident_report", title: "Declaración amistosa firmada", mime_type: "application/pdf", size_bytes: 412000, expires_at: null, created_at: "2026-11-02T19:10:00Z" }]);
      if (u.searchParams.get("fine_id")) return sendList([{ id: "d21", category: "fine_notice", title: "Notificación DGT M-2026/118842", mime_type: "application/pdf", size_bytes: 210000, expires_at: null, created_at: "2026-11-03T09:00:00Z" }]);
      if (u.searchParams.get("maintenance_id")) return sendList([]);
      if (rid) return sendList(centerDocs.filter((d) => d.rental_id === rid));
      if ((u.searchParams.get("select") || "").includes("retention_until")) {
        const st = u.searchParams.get("retention_until"); const cat = (u.searchParams.get("category") || "").replace("eq.", "");
        let rows = centerDocs; if (st) rows = rows.filter((d) => d.retention_until < "2026-11-03"); if (cat) rows = rows.filter((d) => d.category === cat);
        if (u.searchParams.getAll("expires_at").length) rows = rows.filter((d) => d.expires_at && d.expires_at >= "2026-11-03" && d.expires_at <= "2026-12-03");
        return sendList(rows);
      }
      return sendList(vdocs);
    }
    if (u.pathname === "/rest/v1/rentals") { if (idEq) return idEq === RID ? (one ? send(200, rentalDetail) : send(200, [rentalDetail])) : (one ? send(406, { code: "PGRST116" }) : send(200, [])); return sendList(vrentals); }
    if (u.pathname === "/rest/v1/deposits") return sendList(u.searchParams.get("status") === "neq.settled" ? depositsList.filter((d) => d.status !== "settled") : depositsList);
    if (u.pathname === "/rest/v1/insurance_policies") {
      if ((u.searchParams.get("select") || "") === "id, renewed_from_id") return sendList(policies.filter((p) => p.renewed_from_id).map((p) => ({ id: p.id, renewed_from_id: p.renewed_from_id })));
      if (idEq) return pick(policies);
      const vid = (u.searchParams.get("vehicle_id") || "").replace("eq.", "");
      return sendList(policies.filter((p) => !vid || p.vehicle_id === vid).sort((a, b) => a.end_date.localeCompare(b.end_date)));
    }
    if (u.pathname === "/rest/v1/customers") { if (idEq) return pick(customers); return sendList(customers); }
    if (u.pathname === "/rest/v1/customer_documents") return sendList(cdocs);
    if (u.pathname === "/rest/v1/financial_transactions" && (u.searchParams.get("select") || "").includes("source_ref")) return sendList(ftList);
    if (u.pathname === "/rest/v1/financial_transactions") return sendList([{ id: "f1", description: "Aluguel JB-2026-00009", category: "rental", amount: 270, competence_date: "2026-09-19", paid_at: "2026-09-19", status: "paid" }]);
    if (u.pathname === "/rest/v1/activity_logs" && (u.searchParams.get("entity") || "").includes("vehicles")) return sendList(vHistory);
    if (u.pathname === "/rest/v1/inspections" && req.method === "GET") {
      if (idEq) return inspections[idEq] ? (one ? send(200, inspections[idEq]) : send(200, [inspections[idEq]])) : (one ? send(406, { code: "PGRST116" }) : send(200, []));
      const all = Object.values(inspections);
      const rid = (u.searchParams.get("rental_id") || "").replace("eq.", "");
      const rows = rid ? all.filter((i) => i.rental_id === rid) : all;
      if ((u.searchParams.get("select") || "").startsWith("id, inspection_type, status, performed_at, mileage, fuel_level")) return sendList(rows);
      return sendList(rows.map((i) => ({ ...i, rentals: i.rentals ? { contract_number: i.rentals.contract_number } : null })));
    }
    if (u.pathname === "/rest/v1/notifications") return sendList(u.searchParams.get("resolved_at") === "is.null" ? notifs : []);
    if (u.pathname === "/rest/v1/rental_requests") return sendList(requestsM);
    if (u.pathname === "/rest/v1/customer_portal_accounts") return one ? send(200, { invited_at: "2026-10-20T10:00:00Z", last_seen_at: "2026-11-02T20:01:00Z", disabled_at: null, email: "maria.garcia@example.es" }) : sendList([]);
    if (u.pathname === "/rest/v1/maintenance_records" && req.method === "GET") {
      if (idEq) return pick(mrecords);
      if ((u.searchParams.get("select") || "") === "id, plan_id") return sendList(mrecords.filter((r) => r.plan_id && ["scheduled", "in_progress"].includes(r.status)).map((r) => ({ id: r.id, plan_id: r.plan_id })));
      const st = u.searchParams.get("status") || ""; const vid = (u.searchParams.get("vehicle_id") || "").replace("eq.", ""); const did = (u.searchParams.get("damage_id") || "").replace("eq.", "");
      let rows = mrecords;
      if (st.includes("scheduled")) rows = rows.filter((r) => ["scheduled", "in_progress"].includes(r.status)).sort((a, b) => (a.status === "in_progress" ? -1 : 1) - (b.status === "in_progress" ? -1 : 1) || a.scheduled_date.localeCompare(b.scheduled_date));
      else if (st.includes("completed")) rows = rows.filter((r) => ["completed", "cancelled"].includes(r.status));
      if (vid) rows = rows.filter((r) => r.vehicle_id === vid);
      if (did) rows = rows.filter((r) => r.damage_id === did);
      return sendList(rows);
    }
    if (u.pathname === "/rest/v1/maintenance_plans" && req.method === "GET") { const vid = (u.searchParams.get("vehicle_id") || "").replace("eq.", ""); return sendList(plansM.filter((p) => !vid || p.vehicle_id === vid)); }
    if (u.pathname === "/rest/v1/traffic_fines" && req.method === "GET") {
      if (idEq) return pick(finesM);
      let rows = finesM; const st = u.searchParams.get("status") || "";
      if (st.includes("pending")) rows = rows.filter((r) => ["pending", "appealed"].includes(r.status));
      for (const k of ["vehicle_id", "customer_id", "rental_id"]) { const v = (u.searchParams.get(k) || "").replace("eq.", ""); if (v) rows = rows.filter((r) => r[k] === v); }
      return sendList(rows);
    }
    if (u.pathname === "/rest/v1/accidents" && req.method === "GET") {
      if (idEq) return pick(accidentsM);
      let rows = accidentsM;
      for (const k of ["vehicle_id", "customer_id", "rental_id"]) { const v = (u.searchParams.get(k) || "").replace("eq.", ""); if (v) rows = rows.filter((r) => r[k] === v); }
      return sendList(rows);
    }
    if (u.pathname === "/rest/v1/damages" && req.method === "GET") {
      if (idEq) { const d = damagesData.find((x) => x.id === idEq); return d ? (one ? send(200, d) : send(200, [d])) : send(406, { code: "PGRST116" }); }
      if (u.searchParams.get("accident_id")) return sendList(damagesData.filter((d) => d.id === DMG).map((d) => ({ ...d, accident_id: ACC })));
      return sendList(u.searchParams.get("status") === "neq.resolved" ? damagesData.filter((d) => d.status !== "resolved") : damagesData);
    }
    if (u.pathname === "/rest/v1/companies") return send(200, one ? company : [company]);
    if (u.pathname === "/rest/v1/fee_catalog") return send(200, fees);
    if (u.pathname === "/rest/v1/activity_logs") { res.writeHead(200, { "content-type": "application/json", "content-range": `0-${logs.length - 1}/${logs.length}` }); return res.end(JSON.stringify(u.searchParams.get("action") === "eq.auth.login" ? logs.filter((l) => l.action === "auth.login") : logs)); }
    if (u.pathname === "/rest/v1/profiles" && !(u.searchParams.get("id") || "").startsWith("eq.")) return send(200, users);
    if (u.pathname === "/rest/v1/profiles") { if (req.method === "PATCH") return send(204); return (req.headers.accept || "").includes("pgrst.object") ? send(200, profile) : send(200, [profile]); }
    send(404, { message: "not mocked" });
  });
}).listen(Number(process.env.MOCK_PORT ?? 54329), () => console.log("mock on", process.env.MOCK_PORT ?? 54329));
