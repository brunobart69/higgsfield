import type { Dictionary } from "./dictionaries";
import { interpolate } from "./config";

/** Traduz uma chave de `errors.*` (ou `auth.*` para mensagens de sucesso). */
export function errorText(t: Dictionary, key?: string, vars?: Record<string, string>): string | undefined {
  if (!key) return undefined;
  const errors = t.errors as Record<string, string>;
  const auth = t.auth as Record<string, string>;
  const text = key in errors ? errors[key] : key in auth ? auth[key] : errors.generic;
  return vars ? interpolate(text ?? "", vars) : text;
}
