import { describe, it, expect } from "vitest";
import {
  DEFAULT_FIX_TERMS,
  DEFAULT_KPI_TARGETS,
  DEFAULT_SLA_TERMS,
  effectiveFixTerms,
  effectiveKpiTargets,
  effectiveSlaTerms,
  parseFixTerms,
  parseKpiTargets,
  parseSlaLabels,
  parseSlaTerms,
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

describe("SLA terms", () => {
  it("proposes the response and fix terms in working days", () => {
    expect(DEFAULT_SLA_TERMS["critical-vulnerability"]).toEqual({ respondDays: 1, fixDays: 7 });
    expect(DEFAULT_SLA_TERMS["high-vulnerability"]).toEqual({ respondDays: 2, fixDays: 30 });
    expect(DEFAULT_SLA_TERMS["blocking-bug"]).toEqual({ respondDays: 2, fixDays: 10 });
    expect(DEFAULT_SLA_TERMS.bug).toEqual({ respondDays: 5, fixDays: "next-release" });
    expect(DEFAULT_SLA_TERMS["feature-request"]).toEqual({ respondDays: 10, fixDays: null });
    expect(DEFAULT_SLA_TERMS.unclassified).toEqual({ respondDays: 10, fixDays: null });
  });

  it("keeps valid terms of known categories and leaves out the rest", () => {
    expect(
      parseSlaTerms({
        bug: { respondDays: 3, fixDays: 20 },
        question: { respondDays: null, fixDays: null },
        "blocking-bug": { respondDays: 0, fixDays: 5 },
        "high-vulnerability": { respondDays: 2, fixDays: "soon" },
        urgent: { respondDays: 1, fixDays: 1 },
      })
    ).toEqual({ bug: { respondDays: 3, fixDays: 20 }, question: { respondDays: null, fixDays: null } });
    expect(effectiveSlaTerms({ bug: { respondDays: 3, fixDays: 20 } }).bug).toEqual({ respondDays: 3, fixDays: 20 });
    expect(effectiveSlaTerms().question).toEqual(DEFAULT_SLA_TERMS.question);
  });

  it("reads a label map with lower case names, and rejects unknown targets", () => {
    expect(parseSlaLabels({ " P0 ": "blocking-bug", WontFix: "no-fix-term", bug: "ignore" })).toEqual({
      p0: "blocking-bug",
      wontfix: "no-fix-term",
      bug: "ignore",
    });
    expect(parseSlaLabels(null)).toBeNull();
    expect(parseSlaLabels({ bug: "urgent" })).toBeUndefined();
    expect(parseSlaLabels({ "": "bug" })).toBeUndefined();
    expect(parseSlaLabels(["bug"])).toBeUndefined();
  });
});
