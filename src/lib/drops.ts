import { prisma } from "@/lib/db";
import type { FixTerms } from "@/lib/maintenanceTerms";

/** What dropped: a criterion, a rating or the verdict. */
export type DropKind = "criterion" | "rating" | "verdict";

/** The subject of the overall rating; a category rating uses the category name. */
export const OVERALL_RATING_SUBJECT = "overall";

/** Categories that are rated but never count, so their ratings never drop. */
export const INFORMATIVE_CATEGORIES: readonly string[] = ["AI readiness"];

/** The subject of the verdict "suitable for Common Ground". */
export const VERDICT_SUBJECT = "suitable";

/** The stored parts of an analysis that drops are measured on. */
export interface AnalysisSnapshot {
  results: unknown;
  rating: number | null;
  categoryRatings: unknown;
  endorsement: unknown;
}

/** A drop between two analyses, before it is stored. */
export interface DetectedDrop {
  kind: DropKind;
  /** Criterion id, `overall` or a category name, or `suitable` */
  subject: string;
  label: string;
  from: string;
  to: string;
  /** The criterion's requirement level, when it is a criterion */
  requirementLevel?: string;
}

type CriterionState = { status: string; title: string; requirementLevel?: string };

function criterionStates(results: unknown): Map<string, CriterionState> {
  const states = new Map<string, CriterionState>();
  if (!Array.isArray(results)) return states;
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const { id, status, title, requirementLevel } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof status !== "string" || states.has(id)) continue;
    states.set(id, {
      status,
      title: typeof title === "string" && title ? title : id,
      requirementLevel: typeof requirementLevel === "string" ? requirementLevel : undefined,
    });
  }
  return states;
}

function isRatingValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whole stars of a 0.5 to 5.5 rating, as the checker shows them: x.5 rounds up, 1 to 5. */
export function ratingStars(rating: number): number {
  return Math.min(5, Math.max(1, Math.floor(rating + 0.5)));
}

function ratingsBySubject(snapshot: AnalysisSnapshot): Map<string, number> {
  const ratings = new Map<string, number>();
  if (isRatingValue(snapshot.rating)) ratings.set(OVERALL_RATING_SUBJECT, snapshot.rating);
  const categories = snapshot.categoryRatings;
  if (categories && typeof categories === "object" && !Array.isArray(categories)) {
    for (const [category, rating] of Object.entries(categories as Record<string, unknown>)) {
      if (isRatingValue(rating) && category !== OVERALL_RATING_SUBJECT && !INFORMATIVE_CATEGORIES.includes(category)) {
        ratings.set(category, rating);
      }
    }
  }
  return ratings;
}

function isSuitable(snapshot: AnalysisSnapshot): boolean | null {
  const endorsement = snapshot.endorsement;
  if (!endorsement || typeof endorsement !== "object") return null;
  const passed = (endorsement as Record<string, unknown>).passed;
  return typeof passed === "boolean" ? passed : null;
}

function ratingLabel(subject: string): string {
  return subject === OVERALL_RATING_SUBJECT ? "Overall rating" : `${subject} rating`;
}

/**
 * The drops from one analysis to the next: a criterion that went from pass
 * to fail (informative criteria are left out), a rating that lost a whole
 * star (informative categories are left out), and the verdict "suitable for Common Ground" that was lost. A value
 * missing from either analysis is not a drop.
 */
export function detectDrops(previous: AnalysisSnapshot, current: AnalysisSnapshot): DetectedDrop[] {
  const drops: DetectedDrop[] = [];

  const before = criterionStates(previous.results);
  for (const [id, now] of criterionStates(current.results)) {
    if (now.requirementLevel === "informative") continue;
    if (before.get(id)?.status === "pass" && now.status === "fail") {
      drops.push({
        kind: "criterion",
        subject: id,
        label: now.title,
        from: "pass",
        to: "fail",
        requirementLevel: now.requirementLevel,
      });
    }
  }

  const ratingsBefore = ratingsBySubject(previous);
  for (const [subject, rating] of ratingsBySubject(current)) {
    const earlier = ratingsBefore.get(subject);
    if (earlier === undefined) continue;
    const from = ratingStars(earlier);
    const to = ratingStars(rating);
    if (to < from) {
      drops.push({ kind: "rating", subject, label: ratingLabel(subject), from: String(from), to: String(to) });
    }
  }

  if (isSuitable(previous) === true && isSuitable(current) === false) {
    drops.push({
      kind: "verdict",
      subject: VERDICT_SUBJECT,
      label: "Suitable for Common Ground",
      from: "suitable",
      to: "not suitable",
    });
  }

  return drops;
}

/** Whether an analysis recovers a drop: the criterion passes, the rating has its stars back, or the verdict is suitable again. */
export function isRecovered(
  drop: { kind: string; subject: string; fromValue: string },
  current: AnalysisSnapshot
): boolean {
  if (drop.kind === "criterion") {
    return criterionStates(current.results).get(drop.subject)?.status === "pass";
  }
  if (drop.kind === "rating") {
    const rating = ratingsBySubject(current).get(drop.subject);
    return rating !== undefined && ratingStars(rating) >= Number(drop.fromValue);
  }
  if (drop.kind === "verdict") return isSuitable(current) === true;
  return false;
}

/** The fix term in days for a drop. */
export function fixTermDays(drop: Pick<DetectedDrop, "kind" | "subject" | "requirementLevel">, terms: FixTerms): number {
  if (drop.kind === "criterion") {
    return terms.criteria[drop.subject] ?? (drop.requirementLevel === "mandatory" ? terms.mandatory : terms.recommended);
  }
  if (drop.kind === "rating") return terms.ratings[drop.subject] ?? terms.rating;
  return terms.verdict;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** A stored drop, as the database returns it. */
export interface MaintenanceDropRow {
  id: string;
  repoId: string;
  analysisId: string;
  previousAnalysisId: string;
  scannedRefKind: string | null;
  checklistVersion?: string | null;
  kind: string;
  subject: string;
  label: string;
  fromValue: string;
  toValue: string;
  detectedAt: Date;
  fixTermDays: number;
  fixBy: Date;
  resolvedAt: Date | null;
  resolvedAnalysisId: string | null;
}

/** A drop as the API returns it; `overdue` when it is open past its fix-by date. */
export function toDropResponse(drop: MaintenanceDropRow, now: Date = new Date()) {
  return {
    id: drop.id,
    repoId: drop.repoId,
    analysisId: drop.analysisId,
    previousAnalysisId: drop.previousAnalysisId,
    scannedRefKind: drop.scannedRefKind,
    checklistVersion: drop.checklistVersion ?? null,
    kind: drop.kind,
    subject: drop.subject,
    label: drop.label,
    from: drop.fromValue,
    to: drop.toValue,
    detectedAt: drop.detectedAt,
    fixTermDays: drop.fixTermDays,
    fixBy: drop.fixBy,
    resolvedAt: drop.resolvedAt,
    resolvedAnalysisId: drop.resolvedAnalysisId,
    overdue: drop.resolvedAt === null && drop.fixBy.getTime() < now.getTime(),
  };
}

export type DropResponse = ReturnType<typeof toDropResponse>;

/** How many drops a list returns at most. */
export const DROP_LIST_LIMIT = 100;

/** The drops of a repository, newest first; only the open ones when `open` is set. */
export async function listRepositoryDrops(repoId: string, options: { open?: boolean } = {}) {
  const drops = (await prisma.maintenanceDrop.findMany({
    where: { repoId, ...(options.open ? { resolvedAt: null } : {}) },
    orderBy: { detectedAt: "desc" },
    take: DROP_LIST_LIMIT,
  })) as MaintenanceDropRow[];
  const now = new Date();
  return drops.map((drop) => toDropResponse(drop, now));
}

/** A stored analysis, as far as drop detection needs it. */
export interface StoredAnalysis extends AnalysisSnapshot {
  id: string;
  repoId: string;
  checkedAt: Date;
  scannedRefKind: string | null;
  checklistVersion: string | null;
}

/**
 * Compares a just stored analysis with the previous analysis of the same
 * repository, scanned ref kind and checklist version. A new checklist
 * version, or an analysis without one, starts a new baseline, so a change
 * of the checker itself is never a drop. Open drops of the same ref kind
 * that this analysis recovers are resolved, also across checklist
 * versions; new drops are stored with their fix-by date. A subject that
 * already has an open drop gets no second one. Returns the new drops.
 */
export async function recordAnalysisDrops(
  analysis: StoredAnalysis,
  terms: FixTerms
): Promise<MaintenanceDropRow[]> {
  const scope = { repoId: analysis.repoId, scannedRefKind: analysis.scannedRefKind };

  const open = (await prisma.maintenanceDrop.findMany({
    where: { ...scope, resolvedAt: null },
  })) as MaintenanceDropRow[];

  const stillOpen = new Set<string>();
  for (const drop of open) {
    if (drop.detectedAt.getTime() < analysis.checkedAt.getTime() && isRecovered(drop, analysis)) {
      await prisma.maintenanceDrop.update({
        where: { id: drop.id },
        data: { resolvedAt: analysis.checkedAt, resolvedAnalysisId: analysis.id },
      });
    } else {
      stillOpen.add(`${drop.kind}:${drop.subject}`);
    }
  }

  if (analysis.checklistVersion === null) return [];
  const previous = (await prisma.repoAnalysis.findFirst({
    where: { ...scope, id: { not: analysis.id }, checkedAt: { lt: analysis.checkedAt } },
    orderBy: { checkedAt: "desc" },
  })) as (AnalysisSnapshot & { id: string; checklistVersion: string | null }) | null;
  if (!previous || previous.checklistVersion !== analysis.checklistVersion) return [];

  const created: MaintenanceDropRow[] = [];
  for (const drop of detectDrops(previous, analysis)) {
    if (stillOpen.has(`${drop.kind}:${drop.subject}`)) continue;
    const termDays = fixTermDays(drop, terms);
    created.push(
      (await prisma.maintenanceDrop.create({
        data: {
          repoId: analysis.repoId,
          analysisId: analysis.id,
          previousAnalysisId: previous.id,
          scannedRefKind: analysis.scannedRefKind,
          checklistVersion: analysis.checklistVersion,
          kind: drop.kind,
          subject: drop.subject,
          label: drop.label,
          fromValue: drop.from,
          toValue: drop.to,
          detectedAt: analysis.checkedAt,
          fixTermDays: termDays,
          fixBy: addDays(analysis.checkedAt, termDays),
        },
      }))
    );
  }
  return created;
}

/**
 * How many drops are open, how many of those are past their fix-by date,
 * and the earliest fix-by date of the open drops.
 */
export function openDropCounts(drops: Array<{ fixBy: Date }>, now: number) {
  const fixByTimes = drops.map((drop) => drop.fixBy.getTime());
  return {
    openDropCount: drops.length,
    overdueDropCount: fixByTimes.filter((time) => time < now).length,
    nextFixBy: fixByTimes.length > 0 ? new Date(Math.min(...fixByTimes)) : null,
  };
}
