import { describe, it, expect } from "vitest";
import {
  buildUsageStatus,
  declaredOrganisations,
  organisationKey,
  parseDay,
  parseSlaInput,
} from "@/lib/usage";

const validSla = {
  party: "VNG",
  maintainer: "Maykin Media",
  startsOn: "2026-01-01",
  until: "2027-12-31",
  link: "https://example.org/sla",
};

describe("organisationKey", () => {
  it("ignores case, outer whitespace and runs of inner whitespace", () => {
    expect(organisationKey("  Gemeente  UTRECHT ")).toBe("gemeente utrecht");
    expect(organisationKey("Súdwest-Fryslân")).toBe(organisationKey("SÚDWEST-FRYSLÂN"));
  });
});

describe("declaredOrganisations", () => {
  it("drops blanks, non-strings and duplicates and keeps the first spelling", () => {
    expect(declaredOrganisations([" Utrecht ", "utrecht", "", "  ", 3, "Den  Haag"])).toEqual([
      "Utrecht",
      "Den Haag",
    ]);
  });

  it("returns null when the value is not a list", () => {
    expect(declaredOrganisations(undefined)).toBeNull();
    expect(declaredOrganisations("Utrecht")).toBeNull();
  });

  it("returns an empty list for an empty usedBy", () => {
    expect(declaredOrganisations([])).toEqual([]);
  });
});

describe("parseDay", () => {
  it("accepts a calendar date as midnight UTC", () => {
    expect(parseDay("2026-11-19")?.toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });

  it("rejects other formats and impossible dates", () => {
    expect(parseDay("19-11-2026")).toBeNull();
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("2026-11-19T10:00:00Z")).toBeNull();
    expect(parseDay(20261119)).toBeNull();
  });
});

describe("parseSlaInput", () => {
  it("accepts a complete SLA", () => {
    expect(parseSlaInput(validSla)).toEqual({
      value: {
        party: "VNG",
        maintainer: "Maykin Media",
        startsOn: new Date("2026-01-01T00:00:00Z"),
        until: new Date("2027-12-31T00:00:00Z"),
        link: "https://example.org/sla",
      },
    });
  });

  it("stores an empty link as null", () => {
    const parsed = parseSlaInput({ ...validSla, link: "  " });
    expect("value" in parsed && parsed.value.link).toBeNull();
  });

  it.each([
    [{ party: "" }, "Missing party: who contracts the maintainer, usually a municipality, on the VNG model contract"],
    [{ maintainer: undefined }, "Missing maintainer"],
    [{ startsOn: "soon" }, "invalid startsOn"],
    [{ until: null }, "invalid until"],
    [{ until: "2025-12-31" }, "ends before it starts"],
    [{ link: "not a link" }, "Invalid link"],
  ])("rejects %o", (change, message) => {
    const parsed = parseSlaInput({ ...validSla, ...change });
    expect("error" in parsed && parsed.error).toContain(message);
  });

  it("accepts an SLA of one day", () => {
    expect("value" in parseSlaInput({ ...validSla, until: validSla.startsOn })).toBe(true);
  });
});

describe("buildUsageStatus", () => {
  const createdAt = new Date("2026-11-19T10:00:00Z");
  const slas = [
    {
      id: "s1",
      party: "VNG",
      maintainer: "A",
      startsOn: new Date("2024-01-01T00:00:00Z"),
      until: new Date("2025-01-01T00:00:00Z"),
      link: null,
      createdAt,
    },
    {
      id: "s2",
      party: "VNG",
      maintainer: "B",
      startsOn: new Date("2025-01-01T00:00:00Z"),
      until: new Date("2027-01-01T00:00:00Z"),
      link: "https://example.org/sla",
      createdAt,
    },
  ];

  it("counts the declared users of the latest analysis", () => {
    const status = buildUsageStatus(["Utrecht", "Tilburg"], []);
    expect(status).toEqual({ declaredUsers: ["Utrecht", "Tilburg"], declaredUserCount: 2, slas: [] });
  });

  it("lists SLAs with the latest end date first, as dates", () => {
    const status = buildUsageStatus([], slas);
    expect(status.slas.map((sla) => [sla.id, sla.until])).toEqual([
      ["s2", "2027-01-01"],
      ["s1", "2025-01-01"],
    ]);
    expect(status.slas[0]).toMatchObject({ startsOn: "2025-01-01", link: "https://example.org/sla" });
  });

  it("reports no count when the latest analysis did not record declared users", () => {
    const status = buildUsageStatus(null, []);
    expect(status.declaredUsers).toBeNull();
    expect(status.declaredUserCount).toBeNull();
  });
});
