/**
 * The evidence of the "Supported standards" result of an analysis: the
 * standards publiccode.yml declares and the standard APIs found in the
 * repository. The repository list gives it, so the frontend can filter on
 * standards without loading every analysis.
 */
export function standardsEvidenceOf(results: unknown): string[] | null {
  if (!Array.isArray(results)) return null;
  const result = results.find(
    (item): item is { id: string; evidence?: unknown } =>
      !!item && typeof item === "object" && (item as { id?: unknown }).id === "standards"
  );
  if (!result) return null;
  return Array.isArray(result.evidence) ? result.evidence.filter((line): line is string => typeof line === "string") : [];
}
