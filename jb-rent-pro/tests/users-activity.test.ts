import { describe, expect, it } from "vitest";
import { inviteSchema, profileSchema, roleSchema } from "@/lib/validation/users";
import { describeUserAgent, madridStartOfDay, sanitizeFilters } from "@/lib/activity/utils";
import { mapDbError } from "@/lib/db-errors";

describe("usuários", () => {
  it("convite", () => {
    expect(inviteSchema.parse({ email: " Ana@JBRent.es ", full_name: "Ana López", role: "admin" }).email).toBe("ana@jbrent.es");
    expect(inviteSchema.safeParse({ email: "x", full_name: "A", role: "admin" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.es", full_name: "Ana", role: "superuser" }).success).toBe(false);
  });
  it("cargo e perfil", () => {
    expect(roleSchema.safeParse({ user_id: "not-a-uuid", role: "owner" }).success).toBe(false);
    expect(profileSchema.parse({ full_name: "Ana", phone: "+34 600 123 456", locale: "es-ES" }).phone).toBe("+34 600 123 456");
    expect(profileSchema.safeParse({ full_name: "Ana", phone: "abc", locale: "es-ES" }).success).toBe(false);
  });
});

describe("registro de atividades", () => {
  it("sanitiza filtros vindos da URL", () => {
    expect(sanitizeFilters({ page: "-3", user: "x", entity: "vehicles;drop", action: "hack", from: "2026-13-01" })).toEqual({
      page: 1,
      userId: undefined,
      entity: undefined,
      action: undefined,
      from: undefined,
      to: undefined,
    });
    expect(sanitizeFilters({ page: "2", entity: "vehicles", action: "update", to: "2026-11-03" })).toMatchObject({
      page: 2,
      entity: "vehicles",
      action: "update",
      to: "2026-11-03",
    });
  });
  it("início do dia em Madrid (CET/CEST)", () => {
    expect(madridStartOfDay("2026-01-15")).toBe("2026-01-15T00:00:00+01:00");
    expect(madridStartOfDay("2026-07-15")).toBe("2026-07-15T00:00:00+02:00");
  });
  it("descreve o dispositivo", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36")).toBe("Chrome · Windows");
    expect(describeUserAgent(null)).toBe("—");
  });
});

describe("erros do banco", () => {
  it("mapeia mensagens e códigos", () => {
    expect(mapDbError({ code: "P0001", message: "LAST_OWNER: company must keep..." })).toBe("lastOwner");
    expect(mapDbError({ code: "42501", message: "PERMISSION_DENIED: cannot deactivate yourself" })).toBe("cannotChangeSelf");
    expect(mapDbError({ code: "42501", message: "new row violates row-level security policy" })).toBe("forbidden");
    expect(mapDbError({ code: "23P01", message: "conflicting key value violates exclusion constraint" })).toBe("bookingConflict");
    expect(mapDbError({ code: "23505" })).toBe("duplicate");
    expect(mapDbError(null)).toBe("generic");
  });
});
