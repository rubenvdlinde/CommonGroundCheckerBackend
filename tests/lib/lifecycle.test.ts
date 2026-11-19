import { describe, it, expect } from "vitest";
import { developmentStatusFromResults, parseRetireRequest, toLifecycleFields } from "@/lib/lifecycle";

describe("parseRetireRequest", () => {
  it("accepts a retirement with a reason, with its whitespace collapsed", () => {
    expect(parseRetireRequest({ retired: true, reason: " Replaced \n by  X " })).toEqual({
      retired: true,
      reason: "Replaced by X",
    });
  });

  it("accepts undoing a retirement without a reason", () => {
    expect(parseRetireRequest({ retired: false, reason: "ignored" })).toEqual({ retired: false });
  });

  it("rejects a missing body, a missing reason and a reason over 500 characters", () => {
    expect(parseRetireRequest(undefined)).toHaveProperty("error");
    expect(parseRetireRequest({ retired: true })).toHaveProperty("error");
    expect(parseRetireRequest({ retired: true, reason: "x".repeat(500) })).toEqual({
      retired: true,
      reason: "x".repeat(500),
    });
    expect(parseRetireRequest({ retired: true, reason: "x".repeat(501) })).toHaveProperty("error");
  });
});

describe("toLifecycleFields", () => {
  it("gives null for a repository that was never retired", () => {
    expect(toLifecycleFields({})).toEqual({ retiredAt: null, retiredReason: null });
  });
});

describe("developmentStatusFromResults", () => {
  it("reads the development status of the scanned publiccode.yml", () => {
    expect(
      developmentStatusFromResults([
        { id: "license" },
        { id: "publiccode", publiccode: { developmentStatus: " stable " } },
      ])
    ).toBe("stable");
  });

  it("gives null without a publiccode result, without the field, or for results that are not a list", () => {
    expect(developmentStatusFromResults([{ id: "license" }])).toBeNull();
    expect(developmentStatusFromResults([{ id: "publiccode", publiccode: { developmentStatus: "" } }])).toBeNull();
    expect(developmentStatusFromResults({})).toBeNull();
  });
});
