import { describe, it, expect } from "vitest";
import {
  buildUsageStatus,
  countConfirmed,
  declaredOrganisations,
  organisationKey,
  parseConfirmationInput,
  parseDay,
  parseSlaInput,
} from "@/lib/usage";

const validConfirmation = {
  organisation: "  Gemeente   Utrecht ",
  confirmedOn: "2026-11-01",
  source: "https://example.org/letter.pdf",
  method: "written-confirmation",
};

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

describe("countConfirmed", () => {
  it("counts declared organisations with a confirmation, matching names case-insensitively", () => {
    expect(countConfirmed(["Utrecht", "Den Haag", "Tilburg"], ["utrecht", "den haag", "amsterdam"])).toBe(2);
  });

  it("is 0 without confirmations", () => {
    expect(countConfirmed(["Utrecht"], [])).toBe(0);
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

describe("parseConfirmationInput", () => {
  it("normalises the name and keeps the key for matching", () => {
    const parsed = parseConfirmationInput(validConfirmation);
    expect(parsed).toEqual({
      value: {
        organisation: "Gemeente Utrecht",
        organisationKey: "gemeente utrecht",
        confirmedOn: new Date("2026-11-01T00:00:00Z"),
        source: "https://example.org/letter.pdf",
        method: "written-confirmation",
      },
    });
  });

  it.each([
    [{ organisation: " " }, "Missing organisation"],
    [{ confirmedOn: "1 November" }, "invalid confirmedOn"],
    [{ source: "letter in the archive" }, "invalid source"],
    [{ source: "ftp://example.org/x" }, "invalid source"],
    [{ method: "phone" }, "invalid method"],
  ])("rejects %o", (change, message) => {
    const parsed = parseConfirmationInput({ ...validConfirmation, ...change });
    expect("error" in parsed && parsed.error).toContain(message);
  });

  it("rejects a missing body", () => {
    expect("error" in parseConfirmationInput(undefined)).toBe(true);
  });

  it("accepts a register entry", () => {
    const parsed = parseConfirmationInput({ ...validConfirmation, method: "register-entry" });
    expect("value" in parsed && parsed.value.method).toBe("register-entry");
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
    [{ party: "" }, "Missing party"],
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
  const confirmations = [
    {
      id: "c2",
      organisation: "Utrecht",
      organisationKey: "utrecht",
      confirmedOn: new Date("2026-11-02T00:00:00Z"),
      source: "https://example.org/b",
      method: "register-entry",
      createdAt,
    },
    {
      id: "c1",
      organisation: "Amsterdam",
      organisationKey: "amsterdam",
      confirmedOn: new Date("2026-11-01T00:00:00Z"),
      source: "https://example.org/a",
      method: "written-confirmation",
      createdAt,
    },
  ];
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

  it("counts confirmations of declared organisations only and marks the others", () => {
    const status = buildUsageStatus(["UTRECHT", "Tilburg"], confirmations, slas);
    expect(status.declaredUserCount).toBe(2);
    expect(status.confirmedUserCount).toBe(1);
    expect(status.confirmations.map((c) => [c.organisation, c.declared])).toEqual([
      ["Amsterdam", false],
      ["Utrecht", true],
    ]);
    expect(status.confirmations[1]).toMatchObject({ confirmedOn: "2026-11-02", method: "register-entry" });
  });

  it("lists SLAs with the latest end date first, as dates", () => {
    const status = buildUsageStatus([], [], slas);
    expect(status.slas.map((sla) => [sla.id, sla.until])).toEqual([
      ["s2", "2027-01-01"],
      ["s1", "2025-01-01"],
    ]);
  });

  it("reports no counts when the latest analysis did not record declared users", () => {
    const status = buildUsageStatus(null, confirmations, []);
    expect(status.declaredUsers).toBeNull();
    expect(status.declaredUserCount).toBeNull();
    expect(status.confirmedUserCount).toBeNull();
    expect(status.confirmations.every((c) => !c.declared)).toBe(true);
  });
});
