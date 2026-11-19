/**
 * Organisations that use followed components, read from the users declared
 * under `usedBy` in publiccode.yml of the latest analysis of each repository.
 *
 * Names group when they are equal after trimming, collapsing whitespace and
 * ignoring case (`organisationKey`). Nothing else is merged: "Gemeente
 * Utrecht" and "Utrecht" stay two organisations. Names that only differ in
 * accents, punctuation, a prefix such as "Gemeente" or one typo are reported
 * as near duplicates for a person to review.
 */
import { organisationKey } from "@/lib/usage";

export interface DeclaringRepository {
  repoId: string;
  /** Names under usedBy in the latest analysis, or null when it did not record them */
  declaredUsers: string[] | null;
}

export interface OrganisationGroup {
  key: string;
  /** The most common spelling; on a tie one in mixed case, then the first seen */
  name: string;
  slug: string;
  /** Every spelling seen, most common first */
  spellings: string[];
  /** Repositories that declare the organisation, in input order */
  repoIds: string[];
}

export interface NearDuplicate {
  names: string[];
  slugs: string[];
}

const collator = new Intl.Collator("nl", { sensitivity: "base", numeric: true });

function withoutAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function mixedCase(value: string): boolean {
  return value !== value.toLowerCase() && value !== value.toUpperCase();
}

/** A URL slug for a name: lower case, without accents, words joined by hyphens. */
export function organisationSlug(name: string): string {
  const slug = withoutAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "organisation";
}

/** Groups the declared users of the given repositories, in the order given, into organisations sorted by name. */
export function aggregateOrganisations(repositories: DeclaringRepository[]): OrganisationGroup[] {
  const groups = new Map<string, { spellings: Map<string, number>; repoIds: string[] }>();
  for (const repository of repositories) {
    const seen = new Set<string>();
    for (const raw of repository.declaredUsers ?? []) {
      const spelling = raw.trim().replace(/\s+/g, " ");
      const key = organisationKey(spelling);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key) ?? { spellings: new Map<string, number>(), repoIds: [] };
      group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
      group.repoIds.push(repository.repoId);
      groups.set(key, group);
    }
  }

  const named = [...groups.entries()].map(([key, group]) => {
    const spellings = [...group.spellings.entries()]
      .sort((a, b) => b[1] - a[1] || Number(mixedCase(b[0])) - Number(mixedCase(a[0])))
      .map(([spelling]) => spelling);
    return { key, name: spellings[0], spellings, repoIds: group.repoIds };
  });
  named.sort((a, b) => collator.compare(a.name, b.name) || a.key.localeCompare(b.key));

  const used = new Set<string>();
  return named.map((group) => {
    const base = organisationSlug(group.name);
    let slug = base;
    for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
    used.add(slug);
    return { ...group, slug };
  });
}

const PREFIXES = [
  "gemeente",
  "municipality of",
  "city of",
  "provincie",
  "province of",
  "waterschap",
  "hoogheemraadschap",
  "ministerie van",
  "ministry of",
];

/** A looser key that ignores accents, punctuation and a leading kind of organisation such as "Gemeente". */
export function looseOrganisationKey(name: string): string {
  let key = withoutAccents(organisationKey(name))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  for (const prefix of PREFIXES) {
    if (key.startsWith(`${prefix} `)) {
      key = key.slice(prefix.length + 1);
      break;
    }
  }
  return key.replace(/\s+/g, "");
}

/** Whether two strings differ by at most one inserted, removed or replaced character. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Loose keys this long or longer also match with one typo; shorter names such as Ede and Epe differ too little. */
const TYPO_MIN_LENGTH = 6;

/**
 * Organisations that are listed separately but may be the same, for a person
 * to check: their loose keys are equal, or differ by one typo.
 */
export function findNearDuplicates(groups: OrganisationGroup[]): NearDuplicate[] {
  const keys = groups.map((group) => looseOrganisationKey(group.name));
  const parent = groups.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));

  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      if (!keys[a] || !keys[b]) continue;
      const similar =
        keys[a] === keys[b] ||
        (Math.min(keys[a].length, keys[b].length) >= TYPO_MIN_LENGTH && withinOneEdit(keys[a], keys[b]));
      if (similar) parent[root(b)] = root(a);
    }
  }

  const clusters = new Map<number, OrganisationGroup[]>();
  groups.forEach((group, index) => clusters.set(root(index), [...(clusters.get(root(index)) ?? []), group]));
  return [...clusters.values()]
    .filter((members) => members.length > 1)
    .map((members) => ({
      names: members.map((member) => member.name),
      slugs: members.map((member) => member.slug),
    }));
}
