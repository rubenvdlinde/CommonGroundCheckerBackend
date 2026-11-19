import { describe, it, expect } from "vitest";
import {
  DEFAULT_FIX_TERMS,
  DEFAULT_KPI_TARGETS,
  effectiveFixTerms,
  effectiveKpiTargets,
  parseFixTerms,
  parseKpiTargets,
} from "@/lib/maintenanceTerms";

describe("fix terms", () => {
  it("proposes 14 days for known vulnerabilities, 30 for a mandatory criterion and 90 for maintainability", () => {
    expect(DEFAULT_FIX_TERMS.criteria.opensourcehealth).toBe(14);
    expect(DEFAULT_FIX_TERMS.mandatory).toBe(30);
    expect(DEFAULT_FIX_TERMS.ratings.Maintainability).toBe(90);
  });

  it("keeps whole days from 1 to 3650 and leaves out the rest", () => {
    expect(
      parseFixTerms({
        criteria: { license: 7, docker: 0, sbom: 1.5, tests: "10" },
        ratings: { overall: 45, Security: 4000 },
        mandatory: 21,
        recommended: -1,
        verdict: 10,
      })
    ).toEqual({ criteria: { license: 7 }, ratings: { overall: 45 }, mandatory: 21, verdict: 10 });
    expect(parseFixTerms(null)).toEqual({});
    expect(parseFixTerms([1])).toEqual({});
  });

  it("puts overrides on top of the defaults, per criterion and per rating", () => {
    const terms = effectiveFixTerms({ criteria: { license: 7 }, ratings: { overall: 45 }, mandatory: 21 });
    expect(terms.criteria).toEqual({ ...DEFAULT_FIX_TERMS.criteria, license: 7 });
    expect(terms.ratings).toEqual({ ...DEFAULT_FIX_TERMS.ratings, overall: 45 });
    expect(terms.mandatory).toBe(21);
    expect(terms.verdict).toBe(DEFAULT_FIX_TERMS.verdict);
    expect(effectiveFixTerms()).toEqual(DEFAULT_FIX_TERMS);
  });
});

describe("KPI targets", () => {
  it("has a proposed target for each CHAOSS metric of the project health set", () => {
    expect(Object.keys(DEFAULT_KPI_TARGETS).sort()).toEqual([
      "change-request-closure-ratio",
      "contributor-absence-factor",
      "issue-response-time",
      "organizational-diversity",
      "release-frequency",
      "time-to-first-response",
    ]);
  });

  it("keeps a min or max of at least 0 and leaves out the rest", () => {
    expect(
      parseKpiTargets({
        "release-frequency": { min: 6 },
        "issue-response-time": { max: 24, min: "x" },
        "time-to-first-response": { max: -1 },
        "organizational-diversity": 3,
      })
    ).toEqual({ "release-frequency": { min: 6 }, "issue-response-time": { max: 24 } });
    expect(parseKpiTargets(undefined)).toEqual({});
  });

  it("puts overrides on top of the defaults", () => {
    expect(effectiveKpiTargets({ "release-frequency": { min: 6 } })).toEqual({
      ...DEFAULT_KPI_TARGETS,
      "release-frequency": { min: 6 },
    });
  });
});
