import { isIsoDate } from "@/lib/periods";

export const ACTIVITY_PAGE_SIZE = 25;
export const ACTIVITY_ACTIONS = [
  "insert",
  "update",
  "delete",
  "auth.login",
  "user.invite",
  "user.password_link",
  "user.sessions_revoked",
  "company.logo_updated",
] as const;

export type ActivityEntry = {
  id: number;
  createdAt: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
};

export type ActivityFilters = {
  page: number;
  userId?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY = /^[a-z_]{2,40}$/;

/** Início do dia civil em Europe/Madrid como timestamp ISO com offset (CET/CEST). */
export function madridStartOfDay(iso: string): string {
  // Usa o deslocamento real de Madrid nessa data (CET/CEST).
  const probe = new Date(`${iso}T12:00:00Z`);
  const tzName = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value; // "GMT+1" | "GMT+2"
  const offset = Number(/GMT([+-]\d+)/.exec(tzName ?? "")?.[1] ?? 1);
  const sign = offset >= 0 ? "+" : "-";
  return `${iso}T00:00:00${sign}${String(Math.abs(offset)).padStart(2, "0")}:00`;
}

export function sanitizeFilters(raw: Record<string, string | undefined>): ActivityFilters {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(raw.page ?? "1", 10) || 1));
  return {
    page,
    userId: raw.user && UUID.test(raw.user) ? raw.user : undefined,
    entity: raw.entity && ENTITY.test(raw.entity) ? raw.entity : undefined,
    action: raw.action && (ACTIVITY_ACTIONS as readonly string[]).includes(raw.action) ? raw.action : undefined,
    from: isIsoDate(raw.from) ? raw.from : undefined,
    to: isIsoDate(raw.to) ? raw.to : undefined,
  };
}

/** Nome legível do dispositivo a partir do user-agent (sem bibliotecas externas). */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "—";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [browser, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}
