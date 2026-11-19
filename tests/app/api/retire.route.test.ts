import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    repo: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $disconnect: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { buildServer } from "@/server";

type MockFn = ReturnType<typeof vi.fn>;
const mockedPrisma = prisma as unknown as { repo: { findUnique: MockFn; update: MockFn } };
const ADMIN_TOKEN = "test-admin-token";
const lastCheckedAt = new Date("2026-11-01T10:00:00Z");

function storedRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: "repo-id",
    followed: true,
    checkIntervalHours: 24,
    lastCheckedAt,
    nextCheckAt: new Date("2026-11-02T10:00:00Z"),
    retiredAt: null,
    retiredReason: null,
    ...overrides,
  };
}

let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SCHEDULER_NIGHTLY_HOUR", "");
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  mockedPrisma.repo.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    storedRepo(data)
  );
  app = buildServer();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllEnvs();
  delete process.env.ADMIN_TOKEN;
});

function putRetire(payload: unknown, token: string | null = ADMIN_TOKEN) {
  return app.inject({
    method: "PUT",
    url: "/api/repositories/repo-id/retire",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as Record<string, unknown>,
  });
}

function updateData() {
  return (mockedPrisma.repo.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
}

describe("PUT /api/repositories/{repoId}/retire", () => {
  it("retires a repository with a reason and stops its scheduled rescans", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(storedRepo());

    const response = await putRetire({ retired: true, reason: "  Replaced by   Open Zaak 2 " });

    expect(response.statusCode).toBe(200);
    const data = updateData();
    expect(data.retiredAt).toBeInstanceOf(Date);
    expect(data).toMatchObject({ retiredReason: "Replaced by Open Zaak 2", nextCheckAt: null });
    expect(JSON.parse(response.payload)).toMatchObject({
      id: "repo-id",
      retiredReason: "Replaced by Open Zaak 2",
      nextCheckAt: null,
    });
  });

  it("keeps the first retirement date when the reason changes", async () => {
    const retiredAt = new Date("2026-10-01T08:00:00Z");
    mockedPrisma.repo.findUnique.mockResolvedValue(storedRepo({ retiredAt, retiredReason: "Old" }));

    await putRetire({ retired: true, reason: "New reason" });

    expect(updateData()).toMatchObject({ retiredAt, retiredReason: "New reason" });
  });

  it("un-retires a repository and schedules a followed one again", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(
      storedRepo({ retiredAt: new Date("2026-10-01T08:00:00Z"), retiredReason: "Old", nextCheckAt: null })
    );

    const response = await putRetire({ retired: false });

    expect(response.statusCode).toBe(200);
    expect(updateData()).toEqual({
      retiredAt: null,
      retiredReason: null,
      nextCheckAt: new Date("2026-11-02T10:00:00Z"),
    });
  });

  it("leaves an unfollowed repository unscheduled when it is un-retired", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(
      storedRepo({ followed: false, checkIntervalHours: null, retiredAt: new Date() })
    );

    await putRetire({ retired: false });

    expect(updateData()).toMatchObject({ nextCheckAt: null });
  });

  it.each([
    [{}, "retired"],
    [{ retired: "yes" }, "retired"],
    [{ retired: true }, "reason"],
    [{ retired: true, reason: "   " }, "reason"],
    [{ retired: true, reason: "x".repeat(501) }, "reason"],
  ])("returns 400 for %j", async (payload, field) => {
    const response = await putRetire(payload);

    expect(response.statusCode).toBe(400);
    expect((JSON.parse(response.payload) as { error: string }).error).toContain(field);
    expect(mockedPrisma.repo.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown repository", async () => {
    mockedPrisma.repo.findUnique.mockResolvedValue(null);

    const response = await putRetire({ retired: false });

    expect(response.statusCode).toBe(404);
  });

  it("returns 401 without a bearer token and changes nothing", async () => {
    const response = await putRetire({ retired: true, reason: "x" }, null);

    expect(response.statusCode).toBe(401);
    expect(mockedPrisma.repo.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.repo.update).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong token", async () => {
    const response = await putRetire({ retired: true, reason: "x" }, "wrong");

    expect(response.statusCode).toBe(401);
    expect(mockedPrisma.repo.update).not.toHaveBeenCalled();
  });

  it("returns 503 when ADMIN_TOKEN is not configured", async () => {
    delete process.env.ADMIN_TOKEN;

    const response = await putRetire({ retired: true, reason: "x" });

    expect(response.statusCode).toBe(503);
    expect(mockedPrisma.repo.update).not.toHaveBeenCalled();
  });
});
