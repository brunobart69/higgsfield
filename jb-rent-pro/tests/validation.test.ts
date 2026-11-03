import { describe, expect, it } from "vitest";
import { changePasswordSchema, mapAuthError, resetSchema, signInSchema, toFieldErrors } from "@/lib/auth/validation";
import { safeInternalPath } from "@/lib/utils";

describe("validação de autenticação", () => {
  it("exige e-mail válido", () => {
    const r = signInSchema.safeParse({ email: "x", password: "a" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).email).toBe("invalidEmail");
  });

  it("política de senha", () => {
    const short = resetSchema.safeParse({ password: "abc123", confirm: "abc123" });
    expect(!short.success && toFieldErrors(short.error).password).toBe("passwordTooShort");
    const weak = resetSchema.safeParse({ password: "somenteletras", confirm: "somenteletras" });
    expect(!weak.success && toFieldErrors(weak.error).password).toBe("passwordWeak");
    const mismatch = resetSchema.safeParse({ password: "SenhaForte123", confirm: "SenhaForte124" });
    expect(!mismatch.success && toFieldErrors(mismatch.error).confirm).toBe("passwordMismatch");
    expect(resetSchema.safeParse({ password: "SenhaForte123", confirm: "SenhaForte123" }).success).toBe(true);
  });

  it("nova senha diferente da atual", () => {
    const r = changePasswordSchema.safeParse({ current: "SenhaForte123", password: "SenhaForte123", confirm: "SenhaForte123" });
    expect(!r.success && toFieldErrors(r.error).password).toBe("samePassword");
  });

  it("mapeia erros do Supabase", () => {
    expect(mapAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("invalidCredentials");
    expect(mapAuthError({ status: 429, message: "x" })).toBe("rateLimited");
    expect(mapAuthError({ message: "Email not confirmed" })).toBe("emailNotConfirmed");
    expect(mapAuthError({ message: "???" })).toBe("generic");
  });

  it("impede open redirect", () => {
    expect(safeInternalPath("/dashboard?x=1")).toBe("/dashboard?x=1");
    expect(safeInternalPath("//evil.com")).toBe("/dashboard");
    expect(safeInternalPath("https://evil.com")).toBe("/dashboard");
    expect(safeInternalPath("/\\evil.com")).toBe("/dashboard");
    expect(safeInternalPath(undefined)).toBe("/dashboard");
  });
});
