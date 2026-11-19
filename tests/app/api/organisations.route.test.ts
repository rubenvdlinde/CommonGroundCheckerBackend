import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    repo: { findMany: vi.fn() },
    $disconnect: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { buildServer } from "@/server";

type MockFn = ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as { repo: { findMany: MockFn } };

const followed = [
  { id: "oz", analyses: [{ declaredUsers: ["Utrecht", "Gemeente Tilburg"], declaredUserCount: 2 }] },
  { id: "of", analyses: [{ declaredUsers: ["utrecht ", "Sudwest Fryslan"], declaredUserCount: 2 }] },
  { id: "old", analyses: [{ declaredUsers: [], declaredUserCount: null }] },
  { id: "new", analyses: [] },
  { id: "sd", analyses: [{ declaredUsers: ["Súdwest-Fryslân"], declaredUserCount: 1 }] },
];

const analysis = {
  id: "analysis-of",
  checkedAt: "2026-11-19T10:00:00.000Z",
  version: "3.0.0",
  scannedRef: "3.0.0",
  scannedRefKind: "declared-version",
  declaredUserCount: 2,
  score: 72,
  results: [{ id: "publiccode", status: "pass" }],
};

const detail = [
  {
    id: "oz",
    owner: "open-zaak",
    name: "open-zaak",
    repoUrl: "https://github.com/open-zaak/open-zaak",
    slas: [
      {
        id: "sla-1",
        repoId: "oz",
        party: "VNG",
        maintainer: "Maykin Media",
        startsOn: new Date("2026-01-01T00:00:00Z"),
        until: new Date("2027-12-31T00:00:00Z"),
        link: null,
        createdAt: new Date("2026-11-19T10:00:00Z"),
      },
    ],
    analyses: [],
  },
  {
    id: "of",
    owner: "open-formulieren",
    name: "Open-Forms",
    repoUrl: "https://github.com/open-formulieren/open-forms",
    slas: [],
    analyses: [analysis],
  },
];

let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.repo.findMany.mockReset().mockResolvedValueOnce(followed).mockResolvedValueOnce(detail);
  app = buildServer();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/organisations", () => {
  it("aggregates the latest analysis of followed repositories, sorted by name", async () => {
    const response = await app.inject({ method: "GET", url: "/api/organisations" });

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.repo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { followed: true }, orderBy: { createdAt: "asc" } })
    );
    const query = mockedPrisma.repo.findMany.mock.calls[0][0] as {
      select: { analyses: { orderBy: unknown; take: number } };
    };
    expect(query.select.analyses).toMatchObject({ orderBy: { checkedAt: "desc" }, take: 1 });
    expect(JSON.parse(response.payload)).toEqual({
      organisations: [
        { name: "Gemeente Tilburg", slug: "gemeente-tilburg", componentCount: 1 },
        { name: "Sudwest Fryslan", slug: "sudwest-fryslan", componentCount: 1 },
        { name: "Súdwest-Fryslân", slug: "sudwest-fryslan-2", componentCount: 1 },
        { name: "Utrecht", slug: "utrecht", componentCount: 2 },
      ],
      nearDuplicates: [
        { names: ["Sudwest Fryslan", "Súdwest-Fryslân"], slugs: ["sudwest-fryslan", "sudwest-fryslan-2"] },
      ],
    });
  });

  it("returns 500 with the message when the database fails", async () => {
    mockedPrisma.repo.findMany.mockReset().mockRejectedValue(new Error("database down"));

    const response = await app.inject({ method: "GET", url: "/api/organisations" });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.payload)).toEqual({ error: "database down" });
  });
});

describe("GET /api/organisations/{slug}", () => {
  it("returns the components of the organisation with their latest analysis and SLAs", async () => {
    const response = await app.inject({ method: "GET", url: "/api/organisations/utrecht" });

    expect(response.statusCode).toBe(200);
    const detailQuery = mockedPrisma.repo.findMany.mock.calls[1][0] as {
      where: unknown;
      select: { analyses: { take: number; select: Record<string, boolean> } };
    };
    expect(detailQuery.where).toEqual({ id: { in: ["oz", "of"] } });
    expect(detailQuery.select.analyses.take).toBe(1);
    expect(detailQuery.select.analyses.select.results).toBe(true);

    const body = JSON.parse(response.payload) as {
      organisation: unknown;
      components: Array<{ name: string; slas: unknown; latestAnalysis: unknown }>;
    };
    expect(body.organisation).toEqual({
      name: "Utrecht",
      slug: "utrecht",
      spellings: ["Utrecht", "utrecht"],
      componentCount: 2,
    });
    expect(body.components.map((component) => component.name)).toEqual(["Open-Forms", "open-zaak"]);
    expect(body.components[0].latestAnalysis).toEqual(analysis);
    expect(body.components[1].latestAnalysis).toBeNull();
    expect(body.components[1].slas).toEqual([
      { id: "sla-1", party: "VNG", maintainer: "Maykin Media", startsOn: "2026-01-01", until: "2027-12-31", link: null },
    ]);
  });

  it("returns 404 for an unknown slug without loading components", async () => {
    const response = await app.inject({ method: "GET", url: "/api/organisations/nowhere" });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.payload)).toEqual({ error: "Organisation not found." });
    expect(mockedPrisma.repo.findMany).toHaveBeenCalledTimes(1);
  });

  it("does not list organisations of repositories whose latest analysis has no users", async () => {
    const response = await app.inject({ method: "GET", url: "/api/organisations/gemeente-tilburg" });

    expect(response.statusCode).toBe(200);
    expect((mockedPrisma.repo.findMany.mock.calls[1][0] as { where: unknown }).where).toEqual({ id: { in: ["oz"] } });
  });
});
