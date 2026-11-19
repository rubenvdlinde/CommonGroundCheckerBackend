/**
 * Fix terms for drops, target values for the project health KPIs, and SLA
 * response and fix terms for issues. The defaults are proposals: who sets
 * the real terms and targets is a governance decision not taken yet.
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

/** The categories issues are measured in for the SLA response and fix times. */
export const SLA_CATEGORIES = [
  "critical-vulnerability",
  "high-vulnerability",
  "blocking-bug",
  "bug",
  "question",
  "documentation",
  "feature-request",
  "unclassified",
] as const;

export type SlaCategory = (typeof SLA_CATEGORIES)[number];

/**
 * Terms in working days (Monday to Friday, Europe/Amsterdam). `fixDays`
 * is "next-release" when a fix is due in the next stable release, and null
 * when the category has no fix term (development, outside maintenance).
 */
export type SlaTerm = {
  respondDays: number | null;
  fixDays: number | "next-release" | null;
};

export const DEFAULT_SLA_TERMS: Record<SlaCategory, SlaTerm> = {
  "critical-vulnerability": { respondDays: 1, fixDays: 7 },
  "high-vulnerability": { respondDays: 2, fixDays: 30 },
  "blocking-bug": { respondDays: 2, fixDays: 10 },
  bug: { respondDays: 5, fixDays: "next-release" },
  question: { respondDays: 10, fixDays: null },
  documentation: { respondDays: 10, fixDays: null },
  "feature-request": { respondDays: 10, fixDays: null },
  unclassified: { respondDays: 10, fixDays: null },
};

function isSlaCategory(value: unknown): value is SlaCategory {
  return typeof value === "string" && (SLA_CATEGORIES as readonly string[]).includes(value);
}

function isWorkingDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 365;
}

/**
 * Reads SLA term overrides per category. A term is a whole number of
 * working days from 1 to 365 or null; a fix term may also be "next-release".
 * Unknown categories and invalid terms are left out.
 */
export function parseSlaTerms(value: unknown): Partial<Record<SlaCategory, SlaTerm>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Partial<Record<SlaCategory, SlaTerm>> = {};
  for (const [category, term] of Object.entries(value as Record<string, unknown>)) {
    if (!isSlaCategory(category) || !term || typeof term !== "object" || Array.isArray(term)) continue;
    const { respondDays, fixDays } = term as Record<string, unknown>;
    const respond = respondDays === null || isWorkingDays(respondDays) ? respondDays : undefined;
    const fix = fixDays === null || fixDays === "next-release" || isWorkingDays(fixDays) ? fixDays : undefined;
    if (respond === undefined || fix === undefined) continue;
    result[category] = { respondDays: respond, fixDays: fix };
  }
  return result;
}

/** The SLA terms in effect: the defaults with the overrides on top. */
export function effectiveSlaTerms(
  overrides: Partial<Record<SlaCategory, SlaTerm>> = {}
): Record<SlaCategory, SlaTerm> {
  return { ...DEFAULT_SLA_TERMS, ...overrides };
}

/**
 * What a label can stand for in a repository's label map: a category, or
 * "no-fix-term" (the issue keeps its response term but has no fix term,
 * like `wontfix`), or "ignore" to switch off one of the default labels.
 */
export const SLA_LABEL_TARGETS = [
  "blocking-bug",
  "bug",
  "question",
  "documentation",
  "feature-request",
  "no-fix-term",
  "ignore",
] as const;

const MAX_SLA_LABELS = 50;

/**
 * Reads a repository's label map: label name to target, on top of the
 * checker's default map of GitHub's default labels. Label names are matched
 * case-insensitively and stored lower case. Null clears the map; undefined
 * means the value is invalid.
 */
export function parseSlaLabels(value: unknown): Record<string, string> | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_SLA_LABELS) return undefined;
  const result: Record<string, string> = {};
  for (const [label, target] of entries) {
    const name = label.trim().toLowerCase();
    if (!name || name.length > 100) return undefined;
    if (typeof target !== "string" || !(SLA_LABEL_TARGETS as readonly string[]).includes(target)) return undefined;
    result[name] = target;
  }
  return result;
}
