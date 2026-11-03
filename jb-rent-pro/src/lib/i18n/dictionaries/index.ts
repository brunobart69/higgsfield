import type { Locale } from "../config";
import type { Dictionary } from "./pt-BR";
import ptBR from "./pt-BR";
import esES from "./es-ES";

export type { Dictionary };

const dictionaries: Record<Locale, Dictionary> = {
  "pt-BR": ptBR,
  "es-ES": esES,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
