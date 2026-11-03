import "server-only";
import { headers } from "next/headers";

/** URL pública do site (links de e-mail). Prefere NEXT_PUBLIC_SITE_URL. */
export async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** IP do cliente informado pelo proxy (Vercel define x-forwarded-for / x-real-ip). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for") ?? h.get("x-real-ip");
}
