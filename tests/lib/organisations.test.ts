import { describe, it, expect } from "vitest";
import {
  aggregateOrganisations,
  findNearDuplicates,
  looseOrganisationKey,
  organisationSlug,
} from "@/lib/organisations";

describe("organisationSlug", () => {
  it("lower-cases, drops accents and joins words with hyphens", () => {
    expect(organisationSlug("Gemeente Utrecht")).toBe("gemeente-utrecht");
    expect(organisationSlug("Súdwest-Fryslân")).toBe("sudwest-fryslan");
    expect(organisationSlug("  's-Hertogenbosch ")).toBe("s-hertogenbosch");
    expect(organisationSlug("VNG Realisatie B.V.")).toBe("vng-realisatie-b-v");
  });

  it("falls back to a fixed slug for a name without letters or digits", () => {
    expect(organisationSlug("—")).toBe("organisation");
  });
});

describe("aggregateOrganisations", () => {
  it("groups names that differ only in case and spacing, once per repository", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: ["Utrecht", "Den Haag", "utrecht"] },
      { repoId: "b", declaredUsers: ["UTRECHT ", "den  haag"] },
      { repoId: "c", declaredUsers: ["Den Haag"] },
    ]);

    expect(groups.map((group) => [group.name, group.slug, group.repoIds])).toEqual([
      ["Den Haag", "den-haag", ["a", "b", "c"]],
      ["Utrecht", "utrecht", ["a", "b"]],
    ]);
    expect(groups[0].spellings).toEqual(["Den Haag", "den haag"]);
  });

  it("keeps the most common spelling, and on a tie one in mixed case, then the first seen", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: ["gemeente tilburg"] },
      { repoId: "b", declaredUsers: ["Gemeente Tilburg"] },
      { repoId: "c", declaredUsers: ["Gemeente Tilburg"] },
      { repoId: "d", declaredUsers: ["AMSTERDAM"] },
      { repoId: "e", declaredUsers: ["Amsterdam"] },
      { repoId: "f", declaredUsers: ["Den haag"] },
      { repoId: "g", declaredUsers: ["Den Haag"] },
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Amsterdam", "Den haag", "Gemeente Tilburg"]);
    expect(groups[0].spellings).toEqual(["Amsterdam", "AMSTERDAM"]);
  });

  it("does not merge different names", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: ["Gemeente Utrecht", "Utrecht", "Provincie Utrecht"] },
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Gemeente Utrecht", "Provincie Utrecht", "Utrecht"]);
  });

  it("skips repositories whose latest analysis did not record users, and blank names", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: null },
      { repoId: "b", declaredUsers: ["", "   ", "Buren"] },
    ]);

    expect(groups).toEqual([
      { key: "buren", name: "Buren", slug: "buren", spellings: ["Buren"], repoIds: ["b"] },
    ]);
  });

  it("gives separate organisations with the same slug a numbered slug", () => {
    const groups = aggregateOrganisations([{ repoId: "a", declaredUsers: ["Den Haag", "Den-Haag"] }]);

    expect(groups.map((group) => [group.name, group.slug])).toEqual([
      ["Den Haag", "den-haag"],
      ["Den-Haag", "den-haag-2"],
    ]);
  });

  it("sorts by name in Dutch collation, not by number of components", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: ["Zwolle", "Súdwest-Fryslân"] },
      { repoId: "b", declaredUsers: ["Zwolle", "Sittard"] },
    ]);

    expect(groups.map((group) => group.name)).toEqual(["Sittard", "Súdwest-Fryslân", "Zwolle"]);
  });
});

describe("looseOrganisationKey", () => {
  it("ignores accents, punctuation and a leading kind of organisation", () => {
    expect(looseOrganisationKey("Gemeente Súdwest-Fryslân")).toBe("sudwestfryslan");
    expect(looseOrganisationKey("Sudwest Fryslan")).toBe("sudwestfryslan");
    expect(looseOrganisationKey("Municipality of Amsterdam")).toBe("amsterdam");
    expect(looseOrganisationKey("Gemeentebelangen")).toBe("gemeentebelangen");
  });
});

describe("findNearDuplicates", () => {
  it("lists organisations that may be the same, without merging them", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: ["Gemeente Utrecht", "Utrecht", "Súdwest-Fryslân", "Rotterdam"] },
      { repoId: "b", declaredUsers: ["Sudwest Fryslan", "Provincie Utrecht"] },
    ]);

    expect(findNearDuplicates(groups)).toEqual([
      { names: ["Gemeente Utrecht", "Provincie Utrecht", "Utrecht"], slugs: ["gemeente-utrecht", "provincie-utrecht", "utrecht"] },
      { names: ["Sudwest Fryslan", "Súdwest-Fryslân"], slugs: ["sudwest-fryslan", "sudwest-fryslan-2"] },
    ]);
    expect(groups).toHaveLength(6);
  });

  it("returns nothing when every name is distinct", () => {
    expect(findNearDuplicates(aggregateOrganisations([{ repoId: "a", declaredUsers: ["Buren", "Haarlem"] }]))).toEqual([]);
  });

  it("lists names that differ by one typo, but not short names", () => {
    const groups = aggregateOrganisations([
      { repoId: "a", declaredUsers: ["Gemeente Haarlem", "Gemeente Ede", "Rotterdam"] },
      { repoId: "b", declaredUsers: ["Gemeente Haarlen", "Gemeente Epe", "Roterdam"] },
    ]);

    expect(findNearDuplicates(groups).map((duplicate) => duplicate.names)).toEqual([
      ["Gemeente Haarlem", "Gemeente Haarlen"],
      ["Roterdam", "Rotterdam"],
    ]);
  });
});
