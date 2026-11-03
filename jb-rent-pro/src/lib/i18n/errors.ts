import type { Dictionary } from "./dictionaries";

/** Traduz uma chave de `errors.*` (ou `auth.*` para mensagens de sucesso). */
export function errorText(t: Dictionary, key?: string): string | undefined {
  if (!key) return undefined;
  const errors = t.errors as Record<string, string>;
  if (key in errors) return errors[key];
  const auth = t.auth as Record<string, string>;
  if (key in auth) return auth[key];
  return errors.generic;
}
