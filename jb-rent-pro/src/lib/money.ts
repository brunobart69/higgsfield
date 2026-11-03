/**
 * Aritmética monetária exata em centavos (inteiros).
 * Os totais oficiais são calculados no PostgreSQL com NUMERIC; este módulo
 * garante que somas e conversões no frontend nunca usem ponto flutuante
 * acumulado.
 */
const DECIMAL = /^(-)?(\d+)(?:[.,](\d{1,}))?$/;

/** "1234.56" | "1.234,56" | 1234.56 → 123456 (centavos). Arredonda meio para cima. */
export function toCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("Invalid amount");
    return toCents(value.toFixed(6));
  }
  let raw = value.trim().replace(/\s|€/g, "");
  // formato europeu "1.234,56" → "1234.56"
  if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/\./g, "").replace(",", ".");
  const m = DECIMAL.exec(raw);
  if (!m) throw new RangeError(`Invalid amount: ${value}`);
  const sign = m[1] ? -1 : 1;
  const intPart = Number(m[2]);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = intPart * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) throw new RangeError("Amount too large");
  return sign * cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Representação decimal exata para enviar ao banco ("1234.50"). */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: Array<string | number>): number {
  return values.reduce<number>((acc, v) => acc + toCents(v), 0);
}
