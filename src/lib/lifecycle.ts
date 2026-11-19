/** The longest reason an admin can give for retiring a repository. */
export const MAX_RETIRED_REASON_LENGTH = 500;

export type RetireRequest = { retired: true; reason: string } | { retired: false };

/**
 * Reads the body of `PUT /api/repositories/{repoId}/retire`:
 * `{ retired: true, reason }` with a reason of 1 to 500 characters, or
 * `{ retired: false }`. Returns an error message for anything else.
 */
export function parseRetireRequest(body: unknown): RetireRequest | { error: string } {
  const value = (body ?? {}) as Record<string, unknown>;
  if (typeof value.retired !== "boolean") {
    return { error: "Missing or invalid retired field: expected a boolean." };
  }
  if (!value.retired) return { retired: false };

  const reason = typeof value.reason === "string" ? value.reason.trim().replace(/\s+/g, " ") : "";
  if (!reason || reason.length > MAX_RETIRED_REASON_LENGTH) {
    return {
      error: `Missing or invalid reason: expected a text of 1 to ${MAX_RETIRED_REASON_LENGTH} characters.`,
    };
  }
  return { retired: true, reason };
}

type LifecycleFieldsSource = {
  retiredAt?: Date | null;
  retiredReason?: string | null;
};

/** Whether and why an admin retired a repository; a retired repository is not rescanned on schedule. */
export function toLifecycleFields(repository: LifecycleFieldsSource) {
  return {
    retiredAt: repository.retiredAt ?? null,
    retiredReason: repository.retiredReason ?? null,
  };
}
