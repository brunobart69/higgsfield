/** Converte erros do PostgREST/PostgreSQL em chaves de tradução (errors.*). */
export function mapDbError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return "generic";
  const msg = err.message ?? "";
  if (msg.includes("LAST_OWNER")) return "lastOwner";
  if (msg.includes("cannot deactivate yourself") || msg.includes("cannot demote itself")) return "cannotChangeSelf";
  if (msg.includes("HARD_DELETE_FORBIDDEN")) return "hardDeleteForbidden";
  if (msg.includes("VEHICLE_NOT_RENTABLE")) return "vehicleNotRentable";
  switch (err.code) {
    case "42501":
      return "forbidden";
    case "23505":
      return "duplicate";
    case "23P01":
      return "bookingConflict";
    case "23514":
    case "22P02":
      return "invalid";
    case "23503":
      return "inUse";
    case "PGRST116":
      return "notFound";
    default:
      return "generic";
  }
}

/** FormData → objeto de strings (ignora arquivos). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
