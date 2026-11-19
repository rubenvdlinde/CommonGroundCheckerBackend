import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    repo: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    repoAnalysis: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    repoSla: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { buildServer } from "@/server";

type MockFn = ReturnType<typeof vi.fn>;
type MockPrisma = {
  repo: { findUnique: MockFn; update: MockFn };
  repoAnalysis: { create: MockFn; findFirst: MockFn };
  repoSla: { findMany: MockFn; create: MockFn; deleteMany: MockFn };
};

const mockedPrisma = prisma as unknown as MockPrisma;
const ADMIN_TOKEN = "test-admin-token";

const vngSla = {
  id: "sla-1",
  repoId: "repo-id",
  party: "VNG",
  maintainer: "Maykin Media",
  startsOn: new Date("2026-01-01T00:00:00Z"),
  until: new Date("2027-12-31T00:00:00Z"),
  link: null,
  createdAt: new Date("2026-11-19T10:00:00Z"),
};

let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  mockedPrisma.repo.findUnique.mockResolvedValue({
    id: "repo-id",
    followed: false,
    checkIntervalHours: null,
  });
  mockedPrisma.repo.update.mockResolvedValue({});
  mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({
    declaredUsers: ["Utrecht", "Den Haag"],
    declaredUserCount: 2,
  });
  mockedPrisma.repoSla.findMany.mockResolvedValue([vngSla]);
  app = buildServer();
});

afterEach(async () => {
  await app.close();
  delete process.env.ADMIN_TOKEN;
});

function request(
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  token: string | null = ADMIN_TOKEN
) {
  return app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
}

const slaBody = {
  party: "VNG",
  maintainer: "Maykin Media",
  startsOn: "2026-01-01",
  until: "2027-12-31",
};

describe("GET /api/repositories/{repoId}/usage", () => {
  it("returns the declared users of the latest analysis and the SLAs without a token", async () => {
    const response = await request("GET", "/api/repositories/repo-id/usage", undefined, null);

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.repoAnalysis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { repoId: "repo-id" }, orderBy: { checkedAt: "desc" } })
    );
    expect(JSON.parse(response.payload)).toEqual({
      declaredUsers: ["Utrecht", "Den Haag"],
      declaredUserCount: 2,
      slas: [
        {
          id: "sla-1",
          party: "VNG",
          maintainer: "Maykin Media",
          startsOn: "2026-01-01",
          until: "2027-12-31",
          link: null,
        },
      ],
    });
  });

  it("reports no declared users when the latest analysis did not record them", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue({ declaredUsers: [], declaredUserCount: null });

    const body = JSON.parse((await request("GET", "/api/repositories/repo-id/usage")).payload) as {
      declaredUsers: unknown;
      declaredUserCount: unknown;
    };

    expect(body.declaredUsers).toBeNull();
    expect(body.declaredUserCount).toBeNull();
  });

  it("reports no declared users for a repository without analyses", async () => {
    mockedPrisma.repoAnalysis.findFirst.mockResolvedValue(null);

    const body = JSON.parse((await request("GET", "/api/repositories/repo-id/usage")).payload) as {
      declaredUserCount: unknown;
    };

    expect(body.declaredUserCount).toBeNull();
  });

  it("returns 404 for an unknown repository", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(null);
    expect((await request("GET", "/api/repositories/missing/usage")).statusCode).toBe(404);
  });
});

describe("POST /api/repositories/{repoId}/usage/slas", () => {
  it("records an SLA and returns the usage status", async () => {
    const response = await request("POST", "/api/repositories/repo-id/usage/slas", slaBody);

    expect(response.statusCode).toBe(201);
    expect(mockedPrisma.repoSla.create).toHaveBeenCalledWith({
      data: {
        repoId: "repo-id",
        party: "VNG",
        maintainer: "Maykin Media",
        startsOn: new Date("2026-01-01T00:00:00Z"),
        until: new Date("2027-12-31T00:00:00Z"),
        link: null,
      },
    });
    expect(JSON.parse(response.payload)).toHaveProperty("slas");
  });

  it("returns 400 for an SLA that ends before it starts", async () => {
    const response = await request("POST", "/api/repositories/repo-id/usage/slas", {
      ...slaBody,
      until: "2025-01-01",
    });
    expect(response.statusCode).toBe(400);
    expect(mockedPrisma.repoSla.create).not.toHaveBeenCalled();
  });

  it("returns 401 without a valid admin token", async () => {
    expect((await request("POST", "/api/repositories/repo-id/usage/slas", slaBody, null)).statusCode).toBe(401);
    expect((await request("POST", "/api/repositories/repo-id/usage/slas", slaBody, "wrong")).statusCode).toBe(401);
    expect(mockedPrisma.repoSla.create).not.toHaveBeenCalled();
  });

  it("returns 503 when the backend has no admin token", async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await request("POST", "/api/repositories/repo-id/usage/slas", slaBody)).statusCode).toBe(503);
  });

  it("returns 404 for an unknown repository", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(null);
    expect((await request("POST", "/api/repositories/missing/usage/slas", slaBody)).statusCode).toBe(404);
  });
});

describe("DELETE /api/repositories/{repoId}/usage/slas/{slaId}", () => {
  it("removes an SLA of this repository only", async () => {
    mockedPrisma.repoSla.deleteMany.mockResolvedValue({ count: 1 });

    const response = await request("DELETE", "/api/repositories/repo-id/usage/slas/sla-1");

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.repoSla.deleteMany).toHaveBeenCalledWith({ where: { id: "sla-1", repoId: "repo-id" } });
  });

  it("returns 404 when nothing was removed", async () => {
    mockedPrisma.repoSla.deleteMany.mockResolvedValue({ count: 0 });
    expect((await request("DELETE", "/api/repositories/repo-id/usage/slas/x")).statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    expect((await request("DELETE", "/api/repositories/repo-id/usage/slas/sla-1", undefined, null)).statusCode).toBe(401);
    expect(mockedPrisma.repoSla.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/repositories/{repoId}/analyses with declared users", () => {
  const analysis = {
    checkedAt: "2026-11-19T10:00:00Z",
    score: 70,
    results: [],
  };

  function createdData() {
    return (mockedPrisma.repoAnalysis.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
  }

  beforeEach(() => {
    mockedPrisma.repoAnalysis.create.mockResolvedValue({ id: "analysis-id" });
  });

  it("stores the declared organisations once each, with their number", async () => {
    const response = await request("POST", "/api/repositories/repo-id/analyses", {
      ...analysis,
      declaredUsers: ["utrecht ", "Den Haag", "UTRECHT", "Tilburg"],
    });

    expect(response.statusCode).toBe(201);
    expect(createdData()).toMatchObject({
      declaredUsers: ["utrecht", "Den Haag", "Tilburg"],
      declaredUserCount: 3,
    });
  });

  it("stores no count when the checker did not send declared users", async () => {
    await request("POST", "/api/repositories/repo-id/analyses", analysis);

    expect(createdData()).not.toHaveProperty("declaredUserCount");
  });

  it("stores zero for an empty usedBy", async () => {
    await request("POST", "/api/repositories/repo-id/analyses", { ...analysis, declaredUsers: [] });

    expect(createdData()).toMatchObject({ declaredUsers: [], declaredUserCount: 0 });
  });
});
