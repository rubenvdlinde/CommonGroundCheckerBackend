import { describe, it, expect } from "vitest";
import { developmentStatusFromResults } from "@/lib/lifecycle";

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
