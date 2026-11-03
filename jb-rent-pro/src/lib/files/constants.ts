/** Limites de arquivos enviados ao Storage (o bucket aceita até 20 MB). */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const PHOTO_MAX_DIMENSION = 2000;
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
export const BUCKET = "documents";
