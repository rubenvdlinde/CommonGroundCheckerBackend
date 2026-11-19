import type { DropResponse } from "@/lib/drops";

type NotifyLogger = {
  error: (obj: object, msg?: string) => void;
};

export type NotifyFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean; status: number }>;

/** How long one webhook call may take. */
const NOTIFY_TIMEOUT_MS = 10_000;

type NotifiedRepository = { id: string; repoUrl: string; owner: string; name: string };

/**
 * Posts one JSON message per new drop to `NOTIFY_WEBHOOK_URL`, when it is
 * set. A failing webhook is logged and never fails the caller.
 */
export async function notifyDrops(
  repository: NotifiedRepository,
  drops: DropResponse[],
  options: { logger: NotifyLogger; url?: string; fetchFn?: NotifyFetch }
): Promise<void> {
  const url = (options.url ?? process.env.NOTIFY_WEBHOOK_URL ?? "").trim();
  if (!url || drops.length === 0) return;
  const fetchFn: NotifyFetch = options.fetchFn ?? fetch;

  await Promise.all(
    drops.map(async (drop) => {
      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: "maintenance.drop",
            repository: {
              id: repository.id,
              repoUrl: repository.repoUrl,
              owner: repository.owner,
              name: repository.name,
            },
            drop,
          }),
          signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Webhook responded with HTTP ${response.status}`);
      } catch (err: unknown) {
        options.logger.error(
          { repoId: repository.id, dropId: drop.id, error: err instanceof Error ? err.message : String(err) },
          "Sending a drop notification failed"
        );
      }
    })
  );
}
