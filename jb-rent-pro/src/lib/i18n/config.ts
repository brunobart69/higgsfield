/**
 * Configuração regional. Para adicionar um idioma:
 *  1. crie dictionaries/<locale>.ts tipado como `Dictionary`
 *  2. adicione o código em LOCALES e em dictionaries/index.ts
 *  3. inclua o rótulo em LOCALE_LABELS
 */
export const LOCALES = ["pt-BR", "es-ES"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";
export const LOCALE_COOKIE = "jb_locale";

export const LOCALE_LABELS: Record<Locale, { short: string; name: string }> = {
  "pt-BR": { short: "PT", name: "Português (Brasil)" },
  "es-ES": { short: "ES", name: "Español (España)" },
};

export const REGION = {
  country: "ES",
  currency: "EUR",
  timeZone: "Europe/Madrid",
} as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Substitui {chave} pelos valores informados. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
