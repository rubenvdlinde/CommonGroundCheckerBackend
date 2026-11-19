import { describe, it, expect, vi } from "vitest";
import { notifyDrops, type NotifyFetch } from "@/lib/notify";
import { toDropResponse, type MaintenanceDropRow } from "@/lib/drops";

const repository = { id: "repo-id", repoUrl: "https://github.com/org/repo", owner: "org", name: "repo" };

function drop(id: string): MaintenanceDropRow {
  return {
    id,
    repoId: "repo-id",
    analysisId: "a2",
    previousAnalysisId: "a1",
    scannedRefKind: "release",
    kind: "criterion",
    subject: "license",
    label: "License",
    fromValue: "pass",
    toValue: "fail",
    detectedAt: new Date("2026-11-19T02:00:00Z"),
    fixTermDays: 30,
    fixBy: new Date("2026-12-19T02:00:00Z"),
    resolvedAt: null,
    resolvedAnalysisId: null,
  };
}

describe("notifyDrops", () => {
  it("posts one JSON message per drop to the webhook", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const logger = { error: vi.fn() };
    const drops = [toDropResponse(drop("d1")), toDropResponse(drop("d2"))];

    await notifyDrops(repository, drops, { logger, url: "https://hooks.test/drops", fetchFn: fetchFn as NotifyFetch });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("https://hooks.test/drops");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      event: "maintenance.drop",
      repository,
      drop: JSON.parse(JSON.stringify(drops[0])) as unknown,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does nothing without a webhook URL or without drops", async () => {
    const fetchFn = vi.fn();
    const logger = { error: vi.fn() };
    await notifyDrops(repository, [toDropResponse(drop("d1"))], { logger, url: "", fetchFn: fetchFn as NotifyFetch });
    await notifyDrops(repository, [], { logger, url: "https://hooks.test", fetchFn: fetchFn as NotifyFetch });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads NOTIFY_WEBHOOK_URL", async () => {
    vi.stubEnv("NOTIFY_WEBHOOK_URL", "https://hooks.test/env");
    try {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      await notifyDrops(repository, [toDropResponse(drop("d1"))], { logger: { error: vi.fn() }, fetchFn: fetchFn as NotifyFetch });
      expect(fetchFn).toHaveBeenCalledWith("https://hooks.test/env", expect.anything());
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("logs a failing or refusing webhook and does not throw", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockRejectedValueOnce(new Error("connection refused"));
    const logger = { error: vi.fn() };

    await expect(
      notifyDrops(repository, [toDropResponse(drop("d1")), toDropResponse(drop("d2"))], {
        logger,
        url: "https://hooks.test",
        fetchFn: fetchFn as NotifyFetch,
      })
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(2);
    const errors = logger.error.mock.calls.map((call) => (call[0] as { error: string }).error).sort();
    expect(errors).toEqual(["Webhook responded with HTTP 500", "connection refused"]);
  });
});
