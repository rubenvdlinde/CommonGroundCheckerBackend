/**
 * Fix terms for drops and target values for the project health KPIs. The
 * defaults are proposals: who sets the real terms and targets is a
 * governance decision that has not been taken yet.
 */

/** Days a maintainer has to recover a drop, by what dropped. */
export interface FixTerms {
  /** Per criterion id; overrides the term of its requirement level */
  criteria: Record<string, number>;
  /** Per rating: `overall` or a category name; overrides `rating` */
  ratings: Record<string, number>;
  /** A mandatory criterion that went from pass to fail */
  mandatory: number;
  /** A recommended criterion that went from pass to fail */
  recommended: number;
  /** A rating that lost a star */
  rating: number;
  /** The verdict "suitable for Common Ground" that was lost */
  verdict: number;
}

/** A target for a measured value: at least `min`, at most `max`, or both. */
export type KpiTarget = {
  min?: number;
  max?: number;
};

export const DEFAULT_FIX_TERMS: FixTerms = {
  criteria: {
    // Known vulnerabilities in dependencies and leaked secrets.
    opensourcehealth: 14,
    secretscanning: 14,
  },
  ratings: {
    Maintainability: 90,
  },
  mandatory: 30,
  recommended: 90,
  rating: 60,
  verdict: 30,
};

/**
 * Proposed targets for the CHAOSS project health metrics, keyed by metric id.
 * Durations are in hours, release frequency in final releases per 12 months.
 */
export const DEFAULT_KPI_TARGETS: Record<string, KpiTarget> = {
  "contributor-absence-factor": { min: 2 },
  "organizational-diversity": { min: 2 },
  "change-request-closure-ratio": { min: 0.8 },
  "time-to-first-response": { max: 48 },
  "issue-response-time": { max: 120 },
  "release-frequency": { min: 4 },
};

const MAX_FIX_TERM_DAYS = 3650;

function isTermDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_FIX_TERM_DAYS;
}

function termRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] =>
      isTermDays(entry[1])
    )
  );
}

/**
 * Reads stored or posted fix term overrides: whole days from 1 to 3650.
 * Invalid entries are left out, so the default applies to them.
 */
export function parseFixTerms(value: unknown): Partial<FixTerms> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: Partial<FixTerms> = {};
  if (raw.criteria !== undefined) result.criteria = termRecord(raw.criteria);
  if (raw.ratings !== undefined) result.ratings = termRecord(raw.ratings);
  for (const key of ["mandatory", "recommended", "rating", "verdict"] as const) {
    if (isTermDays(raw[key])) result[key] = raw[key];
  }
  return result;
}

/** The fix terms in effect: the defaults with the overrides on top. */
export function effectiveFixTerms(overrides: Partial<FixTerms> = {}): FixTerms {
  return {
    ...DEFAULT_FIX_TERMS,
    ...overrides,
    criteria: { ...DEFAULT_FIX_TERMS.criteria, ...overrides.criteria },
    ratings: { ...DEFAULT_FIX_TERMS.ratings, ...overrides.ratings },
  };
}

function isTargetValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Reads stored or posted KPI target overrides per metric id. A target
 * needs a `min` or a `max` of at least 0; anything else is left out.
 */
export function parseKpiTargets(value: unknown): Record<string, KpiTarget> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, KpiTarget> = {};
  for (const [metricId, target] of Object.entries(value as Record<string, unknown>)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) continue;
    const { min, max } = target as Record<string, unknown>;
    const parsed: KpiTarget = {
      ...(isTargetValue(min) ? { min } : {}),
      ...(isTargetValue(max) ? { max } : {}),
    };
    if (parsed.min !== undefined || parsed.max !== undefined) result[metricId] = parsed;
  }
  return result;
}

/** The KPI targets in effect: the defaults with the overrides on top. */
export function effectiveKpiTargets(overrides: Record<string, KpiTarget> = {}): Record<string, KpiTarget> {
  return { ...DEFAULT_KPI_TARGETS, ...overrides };
}
