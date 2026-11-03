import { z } from "zod";

/** Texto opcional: string vazia vira null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "tooLong")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Valor monetário opcional em formato "1234,56" ou "1234.56" → string decimal exata ("1234.56") ou null. */
export const optionalMoney = (max = 9_999_999.99) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const normalized = v.replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
      if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
        ctx.addIssue({ code: "custom", message: "invalidAmount" });
        return z.NEVER;
      }
      if (Number(normalized) > max) {
        ctx.addIssue({ code: "custom", message: "invalidAmount" });
        return z.NEVER;
      }
      const [i, d = ""] = normalized.split(".");
      return `${Number(i)}.${d.padEnd(2, "0")}`;
    });

export const requiredMoney = (max = 9_999_999.99) =>
  optionalMoney(max).transform((v, ctx) => {
    if (v === null) {
      ctx.addIssue({ code: "custom", message: "required" });
      return z.NEVER;
    }
    return v;
  });

export const optionalPercent = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = v.replace(",", ".");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(n) || Number(n) > 100) {
      ctx.addIssue({ code: "custom", message: "invalidPercent" });
      return z.NEVER;
    }
    return n;
  });

export const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
        ctx.addIssue({ code: "custom", message: "invalidNumber" });
        return z.NEVER;
      }
      return Number(v);
    });

export const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!z.email().safeParse(v).success) {
      ctx.addIssue({ code: "custom", message: "invalidEmail" });
      return z.NEVER;
    }
    return v.toLowerCase();
  });

/** Telefone: dígitos, espaços, +, (), - ; 6 a 20 caracteres. */
export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\+?[\d\s()-]{6,20}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "invalidPhone" });
      return z.NEVER;
    }
    return v;
  });

/**
 * NIF/NIE/CIF espanhol — validação apenas de FORMATO (sem dígito de controle),
 * para não rejeitar documentos válidos por regras não confirmadas.
 */
export const optionalSpanishTaxId = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = v.toUpperCase().replace(/[\s.-]/g, "");
    if (!/^(\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[A-HJNP-SUVW]\d{7}[0-9A-J])$/.test(n)) {
      ctx.addIssue({ code: "custom", message: "invalidTaxId" });
      return z.NEVER;
    }
    return n;
  });

export const optionalIban = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = v.toUpperCase().replace(/\s/g, "");
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(n) || !ibanChecksumOk(n)) {
      ctx.addIssue({ code: "custom", message: "invalidIban" });
      return z.NEVER;
    }
    return n;
  });

/** Verificação ISO 13616 (mod 97). */
export function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const uuidSchema = z.guid("invalid");

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Letra de controle do DNI/NIE (algoritmo oficial módulo 23). */
export function spanishIdChecksumOk(value: string): boolean {
  const v = value.toUpperCase().replace(/[\s.-]/g, "");
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(v);
  if (!m) return false;
  const [, prefix, digits, letter] = m;
  if (prefix && digits!.length !== 7) return false;
  if (!prefix && digits!.length !== 8) return false;
  const num = Number((prefix ? String("XYZ".indexOf(prefix)) : "") + digits);
  return DNI_LETTERS[num % 23] === letter;
}

/** Data opcional "YYYY-MM-DD" (campo type=date). */
export const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(`${v}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
      ctx.addIssue({ code: "custom", message: "invalidDate" });
      return z.NEVER;
    }
    return v;
  });

export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
