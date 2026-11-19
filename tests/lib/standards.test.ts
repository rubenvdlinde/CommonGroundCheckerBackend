import { describe, expect, it } from "vitest";
import { standardsEvidenceOf } from "@/lib/standards";

describe("standardsEvidenceOf", () => {
  it("returns the evidence of the Supported standards result", () => {
    const evidence = ["Found in the repository, not declared: Zaken API 1.5.1 in src/openapi.yaml (by title)"];
    expect(standardsEvidenceOf([{ id: "license" }, { id: "standards", evidence: [...evidence, 42] }])).toEqual(evidence);
  });

  it("is empty for a result without evidence, and null without the result", () => {
    expect(standardsEvidenceOf([{ id: "standards" }])).toEqual([]);
    expect(standardsEvidenceOf([{ id: "license" }])).toBeNull();
    expect(standardsEvidenceOf(null)).toBeNull();
  });
});
