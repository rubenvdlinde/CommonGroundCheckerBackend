/**
 * The `developmentStatus` of the publiccode.yml an analysis scanned: read
 * from the first result that carries a `publiccode` object. Null when the
 * file or the field is missing.
 */
export function developmentStatusFromResults(results: unknown): string | null {
  if (!Array.isArray(results)) return null;
  for (const result of results as unknown[]) {
    const publiccode = (result as { publiccode?: unknown } | null)?.publiccode;
    if (!publiccode || typeof publiccode !== "object") continue;
    const status = (publiccode as { developmentStatus?: unknown }).developmentStatus;
    return typeof status === "string" && status.trim() ? status.trim() : null;
  }
  return null;
}
