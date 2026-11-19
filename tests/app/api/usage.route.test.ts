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
    repoUserConfirmation: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
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
  repoUserConfirmation: { findMany: MockFn; findFirst: MockFn; create: MockFn; deleteMany: MockFn };
  repoSla: { findMany: MockFn; create: MockFn; deleteMany: MockFn };
};

const mockedPrisma = prisma as unknown as MockPrisma;
const ADMIN_TOKEN = "test-admin-token";
const createdAt = new Date("2026-11-19T10:00:00Z");

const utrechtConfirmation = {
  id: "conf-1",
  repoId: "repo-id",
  organisation: "Utrecht",
  organisationKey: "utrecht",
  confirmedOn: new Date("2026-11-01T00:00:00Z"),
  source: "https://example.org/letter",
  method: "written-confirmation",
  createdAt,
};

const vngSla = {
  id: "sla-1",
  repoId: "repo-id",
  party: "VNG",
  maintainer: "Maykin Media",
  startsOn: new Date("2026-01-01T00:00:00Z"),
  until: new Date("2027-12-31T00:00:00Z"),
  link: null,
  createdAt,
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
  mockedPrisma.repoUserConfirmation.findMany.mockResolvedValue([utrechtConfirmation]);
  mockedPrisma.repoUserConfirmation.findFirst.mockResolvedValue(null);
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

const confirmationBody = {
  organisation: " den  HAAG ",
  confirmedOn: "2026-11-10",
  source: "https://example.org/register/den-haag",
  method: "register-entry",
};

const slaBody = {
  party: "VNG",
  maintainer: "Maykin Media",
  startsOn: "2026-01-01",
  until: "2027-12-31",
};

describe("GET /api/repositories/{repoId}/usage", () => {
  it("returns the declared users of the latest analysis, the confirmed count and the SLAs without a token", async () => {
    const response = await request("GET", "/api/repositories/repo-id/usage", undefined, null);

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.repoAnalysis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { repoId: "repo-id" }, orderBy: { checkedAt: "desc" } })
    );
    expect(JSON.parse(response.payload)).toEqual({
      declaredUsers: ["Utrecht", "Den Haag"],
      declaredUserCount: 2,
      confirmedUserCount: 1,
      confirmations: [
        {
          id: "conf-1",
          organisation: "Utrecht",
          confirmedOn: "2026-11-01",
          source: "https://example.org/letter",
          method: "written-confirmation",
          declared: true,
        },
      ],
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
      confirmedUserCount: unknown;
    };

    expect(body.declaredUsers).toBeNull();
    expect(body.confirmedUserCount).toBeNull();
  });

  it("returns 404 for an unknown repository", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(null);
    expect((await request("GET", "/api/repositories/missing/usage")).statusCode).toBe(404);
  });
});

describe("POST /api/repositories/{repoId}/usage/confirmations", () => {
  it("records a confirmation under the usedBy spelling and returns the usage status", async () => {
    const response = await request("POST", "/api/repositories/repo-id/usage/confirmations", confirmationBody);

    expect(response.statusCode).toBe(201);
    expect(mockedPrisma.repoUserConfirmation.findFirst).toHaveBeenCalledWith({
      where: { repoId: "repo-id", organisationKey: "den haag" },
    });
    expect(mockedPrisma.repoUserConfirmation.create).toHaveBeenCalledWith({
      data: {
        repoId: "repo-id",
        organisation: "Den Haag",
        organisationKey: "den haag",
        confirmedOn: new Date("2026-11-10T00:00:00Z"),
        source: "https://example.org/register/den-haag",
        method: "register-entry",
      },
    });
    expect(JSON.parse(response.payload)).toHaveProperty("confirmedUserCount");
  });

  it("keeps the admin's spelling for an organisation that usedBy does not name", async () => {
    await request("POST", "/api/repositories/repo-id/usage/confirmations", {
      ...confirmationBody,
      organisation: "Gemeente  Testdorp",
    });

    expect(mockedPrisma.repoUserConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organisation: "Gemeente Testdorp", organisationKey: "gemeente testdorp" }) as unknown,
    });
  });

  it("refuses a second confirmation of the same organisation", async () => {
    mockedPrisma.repoUserConfirmation.findFirst.mockResolvedValue({ ...utrechtConfirmation, organisation: "Den Haag" });

    const response = await request("POST", "/api/repositories/repo-id/usage/confirmations", confirmationBody);

    expect(response.statusCode).toBe(409);
    expect(mockedPrisma.repoUserConfirmation.create).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid confirmation", async () => {
    const response = await request("POST", "/api/repositories/repo-id/usage/confirmations", {
      ...confirmationBody,
      source: "",
    });
    expect(response.statusCode).toBe(400);
    expect(mockedPrisma.repoUserConfirmation.create).not.toHaveBeenCalled();
  });

  it("returns 401 without a valid admin token", async () => {
    const response = await request(
      "POST",
      "/api/repositories/repo-id/usage/confirmations",
      confirmationBody,
      "wrong"
    );
    expect(response.statusCode).toBe(401);
    expect(mockedPrisma.repoUserConfirmation.create).not.toHaveBeenCalled();
  });

  it("returns 503 when the backend has no admin token", async () => {
    delete process.env.ADMIN_TOKEN;
    const response = await request("POST", "/api/repositories/repo-id/usage/confirmations", confirmationBody);
    expect(response.statusCode).toBe(503);
  });

  it("returns 404 for an unknown repository", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(null);
    const response = await request("POST", "/api/repositories/missing/usage/confirmations", confirmationBody);
    expect(response.statusCode).toBe(404);
  });
});

describe("DELETE /api/repositories/{repoId}/usage/confirmations/{confirmationId}", () => {
  it("removes a confirmation of this repository only", async () => {
    mockedPrisma.repoUserConfirmation.deleteMany.mockResolvedValue({ count: 1 });

    const response = await request("DELETE", "/api/repositories/repo-id/usage/confirmations/conf-1");

    expect(response.statusCode).toBe(200);
    expect(mockedPrisma.repoUserConfirmation.deleteMany).toHaveBeenCalledWith({
      where: { id: "conf-1", repoId: "repo-id" },
    });
  });

  it("returns 404 when nothing was removed", async () => {
    mockedPrisma.repoUserConfirmation.deleteMany.mockResolvedValue({ count: 0 });
    const response = await request("DELETE", "/api/repositories/repo-id/usage/confirmations/other");
    expect(response.statusCode).toBe(404);
  });

  it("returns 401 without a token", async () => {
    const response = await request("DELETE", "/api/repositories/repo-id/usage/confirmations/conf-1", undefined, null);
    expect(response.statusCode).toBe(401);
    expect(mockedPrisma.repoUserConfirmation.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/repositories/{repoId}/usage/slas", () => {
  it("records an SLA", async () => {
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
  });

  it("returns 400 for an SLA that ends before it starts", async () => {
    const response = await request("POST", "/api/repositories/repo-id/usage/slas", {
      ...slaBody,
      until: "2025-01-01",
    });
    expect(response.statusCode).toBe(400);
    expect(mockedPrisma.repoSla.create).not.toHaveBeenCalled();
  });

  it("returns 401 without a token", async () => {
    const response = await request("POST", "/api/repositories/repo-id/usage/slas", slaBody, null);
    expect(response.statusCode).toBe(401);
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

  it("stores the declared organisations and the confirmed count at the time of the analysis", async () => {
    mockedPrisma.repoAnalysis.create.mockResolvedValue({ id: "analysis-id" });

    const response = await request("POST", "/api/repositories/repo-id/analyses", {
      ...analysis,
      declaredUsers: ["utrecht ", "Den Haag", "UTRECHT", "Tilburg"],
    });

    expect(response.statusCode).toBe(201);
    expect(createdData()).toMatchObject({
      declaredUsers: ["utrecht", "Den Haag", "Tilburg"],
      declaredUserCount: 3,
      confirmedUserCount: 1,
    });
  });

  it("stores no counts when the checker did not send declared users", async () => {
    mockedPrisma.repoAnalysis.create.mockResolvedValue({ id: "analysis-id" });

    await request("POST", "/api/repositories/repo-id/analyses", analysis);

    expect(createdData()).not.toHaveProperty("declaredUserCount");
    expect(mockedPrisma.repoUserConfirmation.findMany).not.toHaveBeenCalled();
  });

  it("stores zero for an empty usedBy", async () => {
    mockedPrisma.repoAnalysis.create.mockResolvedValue({ id: "analysis-id" });

    await request("POST", "/api/repositories/repo-id/analyses", { ...analysis, declaredUsers: [] });

    expect(createdData()).toMatchObject({ declaredUserCount: 0, confirmedUserCount: 0 });
  });
});
