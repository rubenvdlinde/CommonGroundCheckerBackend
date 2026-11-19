import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    repoAnalysis: { findFirst: vi.fn() },
    maintenanceDrop: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import {
  detectDrops,
  fixTermDays,
  isRecovered,
  ratingStars,
  recordAnalysisDrops,
  toDropResponse,
  type AnalysisSnapshot,
  type MaintenanceDropRow,
} from "@/lib/drops";
import { DEFAULT_FIX_TERMS, effectiveFixTerms } from "@/lib/maintenanceTerms";

type MockFn = ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as {
  repoAnalysis: { findFirst: MockFn };
  maintenanceDrop: { findMany: MockFn; create: MockFn; update: MockFn };
};

function result(id: string, status: string, requirementLevel = "mandatory") {
  return { id, title: `${id} title`, status, requirementLevel };
}

function snapshot(overrides: Partial<AnalysisSnapshot> = {}): AnalysisSnapshot {
  return {
    results: [result("license", "pass"), result("changelog", "pass", "recommended")],
    rating: 4.2,
    categoryRatings: { Governance: 4.6, Maintainability: 3.9 },
    endorsement: { passed: true, reasons: [] },
    ...overrides,
  };
}

describe("ratingStars", () => {
  it("rounds x.5 up and stays within 1 to 5 stars", () => {
    expect(ratingStars(3.49)).toBe(3);
    expect(ratingStars(3.5)).toBe(4);
    expect(ratingStars(0.5)).toBe(1);
    expect(ratingStars(5.5)).toBe(5);
  });
});

describe("detectDrops", () => {
  it("finds nothing when nothing got worse", () => {
    expect(detectDrops(snapshot(), snapshot())).toEqual([]);
  });

  it("records a criterion that goes from pass to fail, not to warn", () => {
    const current = snapshot({
      results: [result("license", "fail"), result("changelog", "warn", "recommended")],
    });
    expect(detectDrops(snapshot(), current)).toEqual([
      {
        kind: "criterion",
        subject: "license",
        label: "license title",
        from: "pass",
        to: "fail",
        requirementLevel: "mandatory",
      },
    ]);
  });

  it("leaves out informative criteria and criteria that were not measured before", () => {
    const previous = snapshot({ results: [result("codemetrics", "pass", "informative")] });
    const current = snapshot({
      results: [result("codemetrics", "fail", "informative"), result("sbom", "fail")],
    });
    expect(detectDrops(previous, current)).toEqual([]);
  });

  it("records a rating that loses a whole star, overall and per category", () => {
    const current = snapshot({ rating: 3.4, categoryRatings: { Governance: 4.5, Maintainability: 3.1 } });
    expect(detectDrops(snapshot(), current)).toEqual([
      { kind: "rating", subject: "overall", label: "Overall rating", from: "4", to: "3" },
      { kind: "rating", subject: "Maintainability", label: "Maintainability rating", from: "4", to: "3" },
    ]);
  });

  it("does not count a lower rating within the same star, or a rating that is missing", () => {
    const current = snapshot({ rating: 3.6, categoryRatings: { Governance: null } });
    expect(detectDrops(snapshot(), current)).toEqual([]);
    expect(detectDrops(snapshot({ rating: null }), snapshot({ rating: 1 }))).toEqual([]);
  });

  it("records the lost verdict, not a verdict that was already lost or unknown", () => {
    const lost = snapshot({ endorsement: { passed: false, reasons: ["Maintainability below 4 stars"] } });
    expect(detectDrops(snapshot(), lost)).toEqual([
      { kind: "verdict", subject: "suitable", label: "Suitable for Common Ground", from: "suitable", to: "not suitable" },
    ]);
    expect(detectDrops(lost, lost)).toEqual([]);
    expect(detectDrops(snapshot({ endorsement: null }), lost)).toEqual([]);
  });
});

describe("isRecovered", () => {
  it("recovers a criterion that passes again", () => {
    const drop = { kind: "criterion", subject: "license", fromValue: "pass" };
    expect(isRecovered(drop, snapshot())).toBe(true);
    expect(isRecovered(drop, snapshot({ results: [result("license", "warn")] }))).toBe(false);
    expect(isRecovered(drop, snapshot({ results: [] }))).toBe(false);
  });

  it("recovers a rating once it has its stars back", () => {
    const drop = { kind: "rating", subject: "Maintainability", fromValue: "4" };
    expect(isRecovered(drop, snapshot({ categoryRatings: { Maintainability: 3.5 } }))).toBe(true);
    expect(isRecovered(drop, snapshot({ categoryRatings: { Maintainability: 3.4 } }))).toBe(false);
    expect(isRecovered(drop, snapshot({ categoryRatings: null }))).toBe(false);
  });

  it("recovers the verdict when the component is suitable again", () => {
    const drop = { kind: "verdict", subject: "suitable", fromValue: "suitable" };
    expect(isRecovered(drop, snapshot())).toBe(true);
    expect(isRecovered(drop, snapshot({ endorsement: { passed: false, reasons: [] } }))).toBe(false);
  });
});

describe("fixTermDays", () => {
  const terms = effectiveFixTerms({ criteria: { license: 7 } });

  it("uses the term of the criterion, else the term of its requirement level", () => {
    expect(fixTermDays({ kind: "criterion", subject: "license", requirementLevel: "mandatory" }, terms)).toBe(7);
    expect(fixTermDays({ kind: "criterion", subject: "opensourcehealth", requirementLevel: "mandatory" }, terms)).toBe(14);
    expect(fixTermDays({ kind: "criterion", subject: "docker", requirementLevel: "mandatory" }, terms)).toBe(30);
    expect(fixTermDays({ kind: "criterion", subject: "changelog", requirementLevel: "recommended" }, terms)).toBe(90);
  });

  it("uses the term of the rating, else the rating default, and the verdict term", () => {
    expect(fixTermDays({ kind: "rating", subject: "Maintainability" }, terms)).toBe(90);
    expect(fixTermDays({ kind: "rating", subject: "overall" }, terms)).toBe(DEFAULT_FIX_TERMS.rating);
    expect(fixTermDays({ kind: "verdict", subject: "suitable" }, terms)).toBe(DEFAULT_FIX_TERMS.verdict);
  });
});

function storedDrop(overrides: Partial<MaintenanceDropRow> = {}): MaintenanceDropRow {
  return {
    id: "drop-1",
    repoId: "repo-id",
    analysisId: "a1",
    previousAnalysisId: "a0",
    scannedRefKind: "release",
    kind: "criterion",
    subject: "license",
    label: "License",
    fromValue: "pass",
    toValue: "fail",
    detectedAt: new Date("2026-11-01T02:00:00Z"),
    fixTermDays: 30,
    fixBy: new Date("2026-12-01T02:00:00Z"),
    resolvedAt: null,
    resolvedAnalysisId: null,
    ...overrides,
  };
}

describe("toDropResponse", () => {
  it("names the values from and to, and flags an open drop past its fix-by date as overdue", () => {
    const response = toDropResponse(storedDrop(), new Date("2026-12-02T00:00:00Z"));
    expect(response).toMatchObject({ from: "pass", to: "fail", overdue: true });
    expect(toDropResponse(storedDrop(), new Date("2026-11-20T00:00:00Z")).overdue).toBe(false);
    expect(
      toDropResponse(storedDrop({ resolvedAt: new Date("2026-11-10T00:00:00Z") }), new Date("2026-12-02T00:00:00Z")).overdue
    ).toBe(false);
  });
});

describe("recordAnalysisDrops", () => {
  const checkedAt = new Date("2026-11-19T02:00:00Z");
  const analysis = {
    id: "a2",
    repoId: "repo-id",
    checkedAt,
    scannedRefKind: "release",
    checklistVersion: "2026.1",
    ...snapshot(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([]);
    mockedPrisma.maintenanceDrop.create.mockImplementation(({ data }: { data: object }) => ({
      id: "new-drop",
      resolvedAt: null,
      resolvedAnalysisId: null,
      ...data,
    }));
  });

  it("compares with the previous analysis of the same repository and scanned ref kind", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ id: "a1", checklistVersion: "2026.1", ...snapshot() });

    await recordAnalysisDrops(analysis, DEFAULT_FIX_TERMS);

    expect(mockedPrisma.repoAnalysis.findFirst).toHaveBeenCalledWith({
      where: { repoId: "repo-id", scannedRefKind: "release", id: { not: "a2" }, checkedAt: { lt: checkedAt } },
      orderBy: { checkedAt: "desc" },
    });
    expect(mockedPrisma.maintenanceDrop.findMany).toHaveBeenCalledWith({
      where: { repoId: "repo-id", scannedRefKind: "release", resolvedAt: null },
    });
  });

  it("stores each new drop with its fix term and fix-by date", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ id: "a1", checklistVersion: "2026.1", ...snapshot() });
    const current = { ...analysis, results: [result("license", "fail")], categoryRatings: { Maintainability: 2.9 } };

    const created = await recordAnalysisDrops(current, DEFAULT_FIX_TERMS);

    expect(created).toHaveLength(2);
    expect(mockedPrisma.maintenanceDrop.create).toHaveBeenNthCalledWith(1, {
      data: {
        repoId: "repo-id",
        analysisId: "a2",
        previousAnalysisId: "a1",
        scannedRefKind: "release",
        checklistVersion: "2026.1",
        kind: "criterion",
        subject: "license",
        label: "license title",
        fromValue: "pass",
        toValue: "fail",
        detectedAt: checkedAt,
        fixTermDays: 30,
        fixBy: new Date("2026-12-19T02:00:00Z"),
      },
    });
    expect(mockedPrisma.maintenanceDrop.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        kind: "rating",
        subject: "Maintainability",
        fromValue: "4",
        toValue: "3",
        fixTermDays: 90,
        fixBy: new Date("2027-02-17T02:00:00Z"),
      }) as unknown,
    });
  });

  it("resolves an open drop that this analysis recovers", async () => {
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([storedDrop()]);
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({
      id: "a1",
      checklistVersion: "2026.1",
      ...snapshot({ results: [result("license", "fail")] }),
    });

    const created = await recordAnalysisDrops(analysis, DEFAULT_FIX_TERMS);

    expect(created).toEqual([]);
    expect(mockedPrisma.maintenanceDrop.update).toHaveBeenCalledWith({
      where: { id: "drop-1" },
      data: { resolvedAt: checkedAt, resolvedAnalysisId: "a2" },
    });
  });

  it("keeps a drop open while it is not recovered and adds no second drop for it", async () => {
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([storedDrop()]);
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ id: "a1", checklistVersion: "2026.1", ...snapshot() });
    const current = { ...analysis, results: [result("license", "fail")] };

    const created = await recordAnalysisDrops(current, DEFAULT_FIX_TERMS);

    expect(created).toEqual([]);
    expect(mockedPrisma.maintenanceDrop.update).not.toHaveBeenCalled();
    expect(mockedPrisma.maintenanceDrop.create).not.toHaveBeenCalled();
  });

  it("does not resolve a drop with an analysis that is not newer than the drop", async () => {
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([storedDrop({ detectedAt: checkedAt })]);
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue(null);

    await recordAnalysisDrops(analysis, DEFAULT_FIX_TERMS);

    expect(mockedPrisma.maintenanceDrop.update).not.toHaveBeenCalled();
  });

  it("starts a new baseline when the checklist version changed, so a checker change is no drop", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ id: "a1", checklistVersion: "2025.4", ...snapshot() });
    const current = { ...analysis, results: [result("license", "fail")] };

    expect(await recordAnalysisDrops(current, DEFAULT_FIX_TERMS)).toEqual([]);
    expect(mockedPrisma.maintenanceDrop.create).not.toHaveBeenCalled();
  });

  it("starts a new baseline after an analysis without a checklist version, and records nothing without one", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ id: "a1", checklistVersion: null, ...snapshot() });
    const current = { ...analysis, results: [result("license", "fail")] };
    expect(await recordAnalysisDrops(current, DEFAULT_FIX_TERMS)).toEqual([]);

    mockedPrisma.repoAnalysis.findFirst.mockClear();
    expect(await recordAnalysisDrops({ ...current, checklistVersion: null }, DEFAULT_FIX_TERMS)).toEqual([]);
    expect(mockedPrisma.repoAnalysis.findFirst).not.toHaveBeenCalled();
    expect(mockedPrisma.maintenanceDrop.create).not.toHaveBeenCalled();
  });

  it("still resolves an open drop from an earlier checklist version", async () => {
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([storedDrop({ checklistVersion: "2025.4" })]);
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ id: "a1", checklistVersion: "2025.4", ...snapshot() });

    await recordAnalysisDrops(analysis, DEFAULT_FIX_TERMS);

    expect(mockedPrisma.maintenanceDrop.update).toHaveBeenCalledWith({
      where: { id: "drop-1" },
      data: { resolvedAt: checkedAt, resolvedAnalysisId: "a2" },
    });
  });

  it("records nothing for the first analysis of a ref kind", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue(null);

    expect(await recordAnalysisDrops(analysis, DEFAULT_FIX_TERMS)).toEqual([]);
    expect(mockedPrisma.maintenanceDrop.create).not.toHaveBeenCalled();
  });
});
