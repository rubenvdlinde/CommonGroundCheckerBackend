import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    repo: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    repoAnalysis: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    maintenanceDrop: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    scoringConfig: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { buildServer } from "@/server";
import { DEFAULT_FIX_TERMS, DEFAULT_KPI_TARGETS } from "@/lib/maintenanceTerms";

type MockFn = ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as {
  repo: { findUnique: MockFn; findFirst: MockFn; findMany: MockFn; update: MockFn };
  repoAnalysis: { create: MockFn; findFirst: MockFn };
  maintenanceDrop: { findMany: MockFn; create: MockFn; update: MockFn };
  scoringConfig: { findFirst: MockFn; create: MockFn };
};

type DropBody = { id: string; from: string; to: string; overdue: boolean; fixBy: string };

const repository = {
  id: "repo-id",
  repoUrl: "https://github.com/example/repo",
  owner: "example",
  name: "repo",
  followed: true,
  checkIntervalHours: 24,
};

function storedDrop(overrides: Record<string, unknown> = {}) {
  return {
    id: "drop-1",
    repoId: "repo-id",
    analysisId: "a2",
    previousAnalysisId: "a1",
    scannedRefKind: "release",
    kind: "criterion",
    subject: "license",
    label: "License",
    fromValue: "pass",
    toValue: "fail",
    detectedAt: new Date("2026-10-01T02:00:00Z"),
    fixTermDays: 30,
    fixBy: new Date("2026-10-31T02:00:00Z"),
    resolvedAt: null,
    resolvedAnalysisId: null,
    ...overrides,
  };
}

let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([]);
  mockedPrisma.scoringConfig.findFirst.mockResolvedValue(null);
  app = buildServer();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await app.close();
});

describe("GET /api/repositories/{repoId}/drops", () => {
  it("lists the drops newest first and flags the overdue ones", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(repository);
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([
      storedDrop(),
      storedDrop({ id: "drop-2", fixBy: new Date("2999-01-01T00:00:00Z") }),
    ]);

    const response = await app.inject({ method: "GET", url: "/api/repositories/repo-id/drops" });

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.maintenanceDrop.findMany).toHaveBeenCalledWith({
      where: { repoId: "repo-id" },
      orderBy: { detectedAt: "desc" },
      take: 100,
    });
    const body = JSON.parse(response.payload) as { drops: DropBody[] };
    expect(body.drops.map((drop) => [drop.id, drop.from, drop.to, drop.overdue])).toEqual([
      ["drop-1", "pass", "fail", true],
      ["drop-2", "pass", "fail", false],
    ]);
  });

  it("lists only the open drops with state=open", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(repository);

    await app.inject({ method: "GET", url: "/api/repositories/repo-id/drops?state=open" });

    expect(mockedPrisma.maintenanceDrop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { repoId: "repo-id", resolvedAt: null } })
    );
  });

  it("rejects an unknown state and an unknown repository", async () => {
    const invalid = await app.inject({ method: "GET", url: "/api/repositories/repo-id/drops?state=closed" });
    expect(invalid.statusCode).toBe(400);

    mockedPrisma.repo.findUnique.mockResolvedValue(null);
    const missing = await app.inject({ method: "GET", url: "/api/repositories/missing/drops" });
    expect(missing.statusCode).toBe(404);
  });
});

describe("drops in the read routes", () => {
  it("returns the drops in the repository history", async () => {
    mockedPrisma.repo.findFirst.mockResolvedValue({
      ...repository,
      topics: [],
      lastCheckedAt: null,
      nextCheckAt: null,
      analyses: [],
    });
    mockedPrisma.maintenanceDrop.findMany.mockResolvedValue([storedDrop()]);

    const response = await app.inject({ method: "GET", url: "/api/repo-history?owner=example&repo=repo" });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { drops: DropBody[] };
    expect(body.drops).toHaveLength(1);
    expect(body.drops[0]).toMatchObject({ id: "drop-1", from: "pass", to: "fail", overdue: true });
  });

  it("counts the open and overdue drops of each repository in the list", async () => {
    mockedPrisma.repo.findMany.mockResolvedValue([
      {
        ...repository,
        helmChartLocations: [],
        dockerLocations: [],
        apiSpecificationLocations: [],
        documentationLocations: [],
        isRegister: false,
        lastCheckedAt: null,
        nextCheckAt: null,
        updatedAt: new Date(),
        analyses: [],
        _count: { analyses: 3 },
        drops: [{ fixBy: new Date("2026-01-01T00:00:00Z") }, { fixBy: new Date("2999-01-01T00:00:00Z") }],
      },
    ]);

    const response = await app.inject({ method: "GET", url: "/api/repositories" });

    expect(mockedPrisma.repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({ drops: { where: { resolvedAt: null }, select: { fixBy: true } } }) as unknown,
      })
    );
    const body = JSON.parse(response.payload) as { repositories: Array<Record<string, unknown>> };
    expect(body.repositories[0]).toMatchObject({ openDropCount: 2, overdueDropCount: 1 });
  });
});

describe("POST /api/repositories/{repoId}/analyses", () => {
  const payload = {
    checkedAt: "2026-11-19T02:00:00Z",
    score: 70,
    scannedRefKind: "release",
    rating: 3.4,
    categoryRatings: { Maintainability: 3.4 },
    endorsement: { passed: false, reasons: ["Maintainability below 4 stars"] },
    results: [{ id: "license", title: "License", status: "fail", requirementLevel: "mandatory" }],
  };
  const previous = {
    id: "a1",
    results: [{ id: "license", title: "License", status: "pass", requirementLevel: "mandatory" }],
    rating: 4.1,
    categoryRatings: { Maintainability: 4.1 },
    endorsement: { passed: true, reasons: [] },
  };

  beforeEach(() => {
    mockedPrisma.repo.findUnique.mockResolvedValue(repository);
    mockedPrisma.repoAnalysis.create.mockImplementation(({ data }: { data: object }) => ({ id: "a2", ...data }));
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue(previous);
    mockedPrisma.maintenanceDrop.create.mockImplementation(({ data }: { data: object }) => ({
      id: `drop-${mockedPrisma.maintenanceDrop.create.mock.calls.length}`,
      resolvedAt: null,
      resolvedAnalysisId: null,
      ...data,
    }));
  });

  it("stores the drops against the previous analysis and posts each one to the webhook", async () => {
    vi.stubEnv("NOTIFY_WEBHOOK_URL", "https://hooks.test/drops");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.inject({ method: "POST", url: "/api/repositories/repo-id/analyses", payload });

    expect(response.statusCode).toBe(201);
    const created = mockedPrisma.maintenanceDrop.create.mock.calls.map(
      ([arg]) => (arg as { data: { kind: string; subject: string; fixTermDays: number } }).data
    );
    expect(created.map((drop) => [drop.kind, drop.subject, drop.fixTermDays])).toEqual([
      ["criterion", "license", 30],
      ["rating", "overall", 60],
      ["rating", "Maintainability", 90],
      ["verdict", "suitable", 30],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const message = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      event: string;
      repository: { repoUrl: string };
      drop: { subject: string; fixBy: string };
    };
    expect(message.event).toBe("maintenance.drop");
    expect(message.repository.repoUrl).toBe("https://github.com/example/repo");
    expect(message.drop).toMatchObject({ subject: "license", fixBy: "2026-12-19T02:00:00.000Z" });
  });

  it("uses the stored fix terms", async () => {
    mockedPrisma.scoringConfig.findFirst.mockResolvedValue({
      id: "config-id",
      criterionWeights: {},
      categoryWeights: {},
      criterionRequirementLevels: {},
      complexityThreshold: 15,
      complexityMaxCcnThreshold: 30,
      spectralRulesetSource: "x",
      fixTerms: { criteria: { license: 7 } },
      kpiTargets: {},
    });

    await app.inject({ method: "POST", url: "/api/repositories/repo-id/analyses", payload });

    expect(mockedPrisma.maintenanceDrop.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: "license",
        fixTermDays: 7,
        fixBy: new Date("2026-11-26T02:00:00Z"),
      }) as unknown,
    });
  });

  it("still stores the analysis when drop detection fails", async () => {
    mockedPrisma.maintenanceDrop.findMany.mockRejectedValue(new Error("database down"));

    const response = await app.inject({ method: "POST", url: "/api/repositories/repo-id/analyses", payload });

    expect(response.statusCode).toBe(201);
    expect(mockedPrisma.repoAnalysis.create).toHaveBeenCalledTimes(1);
  });
});

describe("fix terms and KPI targets in the scoring config", () => {
  it("returns the terms and targets in effect and the proposed defaults", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/scoring" });

    const body = JSON.parse(response.payload) as Record<string, unknown>;
    expect(body.fixTerms).toEqual(DEFAULT_FIX_TERMS);
    expect(body.kpiTargets).toEqual(DEFAULT_KPI_TARGETS);
    expect(body.defaultFixTerms).toEqual(DEFAULT_FIX_TERMS);
    expect(body.defaultKpiTargets).toEqual(DEFAULT_KPI_TARGETS);
  });

  it("stores posted terms and targets", async () => {
    mockedPrisma.scoringConfig.create.mockResolvedValue({ id: "new-config" });

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/scoring",
      payload: { fixTerms: { mandatory: 21, criteria: { license: 0 } }, kpiTargets: { "release-frequency": { min: 6 } } },
    });

    expect(response.statusCode).toBe(200);
    const data = (mockedPrisma.scoringConfig.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.fixTerms).toEqual({ mandatory: 21, criteria: {} });
    expect(data.kpiTargets).toEqual({ "release-frequency": { min: 6 } });
    const body = JSON.parse(response.payload) as { fixTerms: { mandatory: number }; kpiTargets: Record<string, unknown> };
    expect(body.fixTerms.mandatory).toBe(21);
    expect(body.kpiTargets["release-frequency"]).toEqual({ min: 6 });
  });

  it("keeps the stored terms and targets when a save leaves them out, and clears them on reset", async () => {
    mockedPrisma.scoringConfig.findFirst.mockResolvedValue({
      id: "config-id",
      criterionWeights: {},
      categoryWeights: {},
      criterionRequirementLevels: {},
      complexityThreshold: 15,
      complexityMaxCcnThreshold: 30,
      spectralRulesetSource: "x",
      fixTerms: { verdict: 10 },
      kpiTargets: { "release-frequency": { min: 6 } },
    });
    mockedPrisma.scoringConfig.create.mockResolvedValue({ id: "new-config" });

    await app.inject({ method: "POST", url: "/api/admin/scoring", payload: { criterionWeights: {} } });
    await app.inject({ method: "POST", url: "/api/admin/scoring", payload: { reset: true } });

    const saved = mockedPrisma.scoringConfig.create.mock.calls.map(
      ([arg]) => (arg as { data: { fixTerms: unknown; kpiTargets: unknown } }).data
    );
    expect(saved[0]).toMatchObject({ fixTerms: { verdict: 10 }, kpiTargets: { "release-frequency": { min: 6 } } });
    expect(saved[1]).toMatchObject({ fixTerms: {}, kpiTargets: {} });
  });
});
