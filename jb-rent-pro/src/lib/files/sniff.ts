/** Identifica o tipo real do arquivo pelos primeiros bytes (não confia na extensão/MIME declarado). */
export function sniffMime(bytes: Uint8Array): "application/pdf" | "image/png" | "image/jpeg" | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf"; // %PDF
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Caminho no bucket: <empresa>/<entidade>/<id>/<pasta>/<uuid>.<ext> */
export function buildStoragePath(companyId: string, entity: "vehicles" | "customers" | "rentals" | "company", entityId: string, folder: string, ext: string) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${companyId}/${entity}/${entityId}/${folder}/${id}.${ext}`;
}

export function extFor(mime: string) {
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
