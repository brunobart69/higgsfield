"use client";
import { createClient } from "@/lib/supabase/client";
import { BUCKET, MAX_FILE_BYTES, PHOTO_MAX_DIMENSION } from "./constants";

/**
 * Reduz fotos grandes (celular) para no máximo 2000 px em JPEG, antes do
 * envio. Mantém a orientação EXIF (createImageBitmap aplica a rotação).
 */
export async function compressImage(file: File, maxDim = PHOTO_MAX_DIMENSION, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 1.5 * 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

export type UploadResult = { ok: true } | { ok: false; error: "fileTooLarge" | "uploadFailed" };

/** Envia direto do navegador para o Storage privado (a RLS do bucket valida a pasta da empresa). */
export async function uploadToStorage(path: string, body: Blob, contentType: string): Promise<UploadResult> {
  if (body.size > MAX_FILE_BYTES) return { ok: false, error: "fileTooLarge" };
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: "3600" });
  return error ? { ok: false, error: "uploadFailed" } : { ok: true };
}

/** Remove um envio próprio que não pôde ser registrado. */
export async function discardUpload(path: string) {
  try {
    await createClient().storage.from(BUCKET).remove([path]);
  } catch {
    /* ignora */
  }
}

/**
 * Envia várias fotos em sequência: reduz, envia ao Storage e registra no
 * servidor. Se o registro falhar, o arquivo enviado é descartado.
 */
export async function uploadImages(
  files: File[],
  pathFor: (mime: "image/jpeg" | "image/png") => string,
  register: (path: string, size: number, mime: "image/jpeg" | "image/png") => Promise<{ ok?: boolean; error?: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; errors: string[] }> {
  const list = files.filter((f) => f.type === "image/jpeg" || f.type === "image/png");
  let ok = 0;
  const errors: string[] = [];
  for (const [i, file] of list.entries()) {
    const blob = await compressImage(file);
    const mime = blob.type === "image/png" ? "image/png" : "image/jpeg";
    const path = pathFor(mime);
    const up = await uploadToStorage(path, blob, mime);
    if (!up.ok) errors.push(up.error);
    else {
      const res = await register(path, blob.size, mime);
      if (res.ok) ok++;
      else {
        await discardUpload(path);
        errors.push(res.error ?? "uploadFailed");
      }
    }
    onProgress?.(i + 1, list.length);
  }
  return { ok, errors };
}
