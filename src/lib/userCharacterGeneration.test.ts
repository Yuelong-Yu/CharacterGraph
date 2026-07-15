import { describe, expect, it } from "vitest";
import {
  UserCharacterGenerationError,
  parseGeneratedProfile,
  parseGeneratedRelationships,
  targetSelectionTokenBudget,
} from "@/lib/userCharacterGeneration";

describe("user character LLM output parsing", () => {
  it("reserves enough output budget for reasoning over the full character list", () => {
    expect(targetSelectionTokenBudget(3)).toBe(100_000);
    expect(targetSelectionTokenBudget(100)).toBe(100_000);
  });

  it("accepts a fenced JSON object and validates the profile contract", () => {
    const profile = parseGeneratedProfile(`\n\`\`\`json\n{
      "nameEn": "Shen Yan",
      "aliases": ["砚生"],
      "epithet": "行脚书生",
      "bio": "误入梁山的行脚书生。",
      "events": [{"title":"夜入梁山","desc":"沈砚夜入梁山。"}],
      "weapons": [],
      "skills": ["谋略"],
      "domains": [],
      "mounts": []
    }\n\`\`\``);

    expect(profile.nameEn).toBe("Shen Yan");
    expect(profile.events[0].title).toBe("夜入梁山");
  });

  it("rejects relationships containing an unknown target or relation type", () => {
    expect(() => parseGeneratedRelationships(
      `{"relationships":[{"targetId":"gao_qiu","primaryType":"friend","compositeTypes":[],"title":"相遇","desc":"二人相遇。"}]}`,
      new Set(["lin_chong"]),
      new Set(["bond", "hostile"]),
    )).toThrow(UserCharacterGenerationError);
  });

  it("requires exactly the requested relationship targets", () => {
    expect(() => parseGeneratedRelationships(
      `{"relationships":[{"targetId":"lin_chong","primaryType":"bond","compositeTypes":[],"title":"相遇","desc":"二人相遇。"}]}`,
      new Set(["lin_chong", "lu_zhishen"]),
      new Set(["bond", "hostile"]),
    )).toThrow(/关系对象数量不正确/);
  });
});
