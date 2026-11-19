import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    scoringConfig: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { DEFAULT_CRITERION_CONFIG_BY_CHECK_ID, getActiveScoringConfig } from "@/lib/scoring";

const findFirst = (prisma as unknown as { scoringConfig: { findFirst: ReturnType<typeof vi.fn> } }).scoringConfig
  .findFirst;

describe("scoring configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("knows the Artifact Hub criterion: mandatory with weight 1, like the frontend", async () => {
    findFirst.mockResolvedValue(null);

    expect(DEFAULT_CRITERION_CONFIG_BY_CHECK_ID.artifacthub).toEqual({ weight: 1, requirementLevel: "mandatory" });
    expect((await getActiveScoringConfig()).config.criterionConfigByCheckId.artifacthub).toEqual({
      weight: 1,
      requirementLevel: "mandatory",
    });
  });

  it("applies a stored weight and requirement level to the Artifact Hub criterion", async () => {
    findFirst.mockResolvedValue({
      id: "cfg-1",
      criterionWeights: { artifacthub: 0.5 },
      categoryWeights: null,
      criterionRequirementLevels: { artifacthub: "recommended" },
      complexityThreshold: null,
      complexityMaxCcnThreshold: null,
      spectralRulesetSource: null,
    });

    const active = await getActiveScoringConfig();

    expect(active.id).toBe("cfg-1");
    expect(active.config.criterionConfigByCheckId.artifacthub).toEqual({ weight: 0.5, requirementLevel: "recommended" });
  });
});
