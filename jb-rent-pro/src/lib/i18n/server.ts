import "server-only";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";
import { getDictionary } from "./dictionaries";

/** Idioma da interface: cookie → Accept-Language → padrão (pt-BR). */
export async function getLocale(): Promise<Locale> {
  const cookieValue = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieValue)) return cookieValue;
  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  if (accept.startsWith("es")) return "es-ES";
  return DEFAULT_LOCALE;
}

export async function getI18n() {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
