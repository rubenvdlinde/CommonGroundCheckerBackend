/**
 * Declared and confirmed users of a repository, and its SLAs.
 *
 * Declared users are the organisations under `usedBy` in publiccode.yml, as
 * sent by the checker with each analysis. An organisation counts as confirmed
 * when an admin recorded a confirmation for it on that repository. Names match
 * case-insensitively, trimmed and with runs of whitespace read as one space.
 */

export const CONFIRMATION_METHODS = ["written-confirmation", "register-entry"] as const;
export type ConfirmationMethod = (typeof CONFIRMATION_METHODS)[number];

export interface StoredConfirmation {
  id: string;
  organisation: string;
  organisationKey: string;
  confirmedOn: Date;
  source: string;
  method: string;
  createdAt: Date;
}

export interface StoredSla {
  id: string;
  party: string;
  maintainer: string;
  startsOn: Date;
  until: Date;
  link: string | null;
  createdAt: Date;
}

export interface ConfirmationInput {
  organisation: string;
  organisationKey: string;
  confirmedOn: Date;
  source: string;
  method: ConfirmationMethod;
}

export interface SlaInput {
  party: string;
  maintainer: string;
  startsOn: Date;
  until: Date;
  link: string | null;
}

export type Parsed<T> = { value: T } | { error: string };

export function organisationKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The declared organisations without blanks and duplicates, in their first spelling; null when `value` is not a list. */
export function declaredOrganisations(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim().replace(/\s+/g, " ");
    const key = organisationKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** The number of declared organisations that have a confirmation. */
export function countConfirmed(declared: string[], confirmationKeys: Iterable<string>): number {
  const keys = new Set(confirmationKeys);
  return declared.filter((name) => keys.has(organisationKey(name))).length;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** A YYYY-MM-DD calendar date as midnight UTC; null for anything else. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const date = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.trim()) return null;
  return date;
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseConfirmationInput(body: unknown): Parsed<ConfirmationInput> {
  const fields = (body ?? {}) as Record<string, unknown>;
  const organisation = text(fields.organisation);
  if (!organisation) return { error: "Missing organisation: the name of the organisation that uses the component." };
  const confirmedOn = parseDay(fields.confirmedOn);
  if (!confirmedOn) return { error: "Missing or invalid confirmedOn: expected a date as YYYY-MM-DD." };
  const source = text(fields.source);
  if (!httpUrl(source)) {
    return { error: "Missing or invalid source: expected an http(s) link to the written confirmation or the register entry." };
  }
  const method = fields.method;
  if (typeof method !== "string" || !(CONFIRMATION_METHODS as readonly string[]).includes(method)) {
    return { error: `Missing or invalid method: expected one of ${CONFIRMATION_METHODS.join(", ")}.` };
  }
  return {
    value: {
      organisation,
      organisationKey: organisationKey(organisation),
      confirmedOn,
      source,
      method: method as ConfirmationMethod,
    },
  };
}

export function parseSlaInput(body: unknown): Parsed<SlaInput> {
  const fields = (body ?? {}) as Record<string, unknown>;
  const party = text(fields.party);
  if (!party) return { error: "Missing party: who agreed the SLA, for example VNG." };
  const maintainer = text(fields.maintainer);
  if (!maintainer) return { error: "Missing maintainer: the organisation that maintains the component under the SLA." };
  const startsOn = parseDay(fields.startsOn);
  if (!startsOn) return { error: "Missing or invalid startsOn: expected a date as YYYY-MM-DD." };
  const until = parseDay(fields.until);
  if (!until) return { error: "Missing or invalid until: expected a date as YYYY-MM-DD." };
  if (until < startsOn) return { error: "Invalid until: the SLA ends before it starts." };
  const link = text(fields.link);
  if (link && !httpUrl(link)) return { error: "Invalid link: expected an http(s) link to the SLA." };
  return { value: { party, maintainer, startsOn, until, link: link || null } };
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface UsageStatus {
  /** Declared organisations of the latest analysis, or null when it did not record them */
  declaredUsers: string[] | null;
  declaredUserCount: number | null;
  confirmedUserCount: number | null;
  confirmations: Array<{
    id: string;
    organisation: string;
    confirmedOn: string;
    source: string;
    method: string;
    /** Whether the latest analysis declares this organisation; only declared organisations count */
    declared: boolean;
  }>;
  slas: Array<{
    id: string;
    party: string;
    maintainer: string;
    startsOn: string;
    until: string;
    link: string | null;
  }>;
}

/** The usage of a repository now: the latest declared users against today's confirmations, and every SLA. */
export function buildUsageStatus(
  declared: string[] | null,
  confirmations: StoredConfirmation[],
  slas: StoredSla[]
): UsageStatus {
  const declaredKeys = new Set((declared ?? []).map(organisationKey));
  return {
    declaredUsers: declared,
    declaredUserCount: declared ? declared.length : null,
    confirmedUserCount: declared
      ? countConfirmed(
          declared,
          confirmations.map((confirmation) => confirmation.organisationKey)
        )
      : null,
    confirmations: [...confirmations]
      .sort((a, b) => a.organisation.localeCompare(b.organisation))
      .map((confirmation) => ({
        id: confirmation.id,
        organisation: confirmation.organisation,
        confirmedOn: day(confirmation.confirmedOn),
        source: confirmation.source,
        method: confirmation.method,
        declared: declaredKeys.has(confirmation.organisationKey),
      })),
    slas: [...slas]
      .sort((a, b) => b.until.getTime() - a.until.getTime())
      .map((sla) => ({
        id: sla.id,
        party: sla.party,
        maintainer: sla.maintainer,
        startsOn: day(sla.startsOn),
        until: day(sla.until),
        link: sla.link,
      })),
  };
}
