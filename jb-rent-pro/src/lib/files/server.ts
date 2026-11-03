import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, MAX_FILE_BYTES } from "./constants";
import { sniffMime } from "./sniff";

/** URLs temporárias (padrão 10 min) para arquivos do bucket privado. */
export async function signedUrlMap(supabase: SupabaseClient, paths: string[], expiresIn = 600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, expiresIn);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  return out;
}

export type VerifiedUpload = { ok: true; mime: string; size: number } | { ok: false; error: "fileType" | "fileTooLarge" | "uploadFailed" };

/**
 * Confere um arquivo recém-enviado pelo navegador: existe, está na pasta
 * esperada, tem tamanho permitido e o conteúdo real é de um tipo aceito.
 * Lê apenas os primeiros bytes (Range), sem baixar o arquivo inteiro.
 */
export async function verifyUpload(
  supabase: SupabaseClient,
  path: string,
  expectedPrefix: string,
  allowed: readonly string[],
): Promise<VerifiedUpload> {
  if (!path.startsWith(expectedPrefix) || path.includes("..")) return { ok: false, error: "uploadFailed" };
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return { ok: false, error: "uploadFailed" };
  try {
    const res = await fetch(data.signedUrl, { headers: { Range: "bytes=0-15" }, cache: "no-store" });
    if (!res.ok) return { ok: false, error: "uploadFailed" };
    const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, 16);
    const total = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1] ?? res.headers.get("content-length") ?? 0);
    if (total > MAX_FILE_BYTES) return { ok: false, error: "fileTooLarge" };
    const mime = sniffMime(bytes);
    if (!mime || !allowed.includes(mime)) return { ok: false, error: "fileType" };
    return { ok: true, mime, size: total };
  } catch {
    return { ok: false, error: "uploadFailed" };
  }
}

/** Remove um arquivo (falha silenciosa: limpeza de envio rejeitado). */
export async function removeObject(supabase: SupabaseClient, path: string) {
  await supabase.storage.from(BUCKET).remove([path]);
}
