import { describe, expect, it } from "vitest";
import { applyCharacterImageOverrides } from "@/lib/characterImages";
import type { Dataset } from "@/schemas/character";

const dataset = {
  schema_version: 3,
  characters: [{
    schema_version: 3,
    id: "newcomer",
    name_zh: "新人",
    name_en: "Newcomer",
    aliases: [],
    epithet: null,
    category: "hero",
    era_layer: 1,
    bio: null,
    events: [],
    quotes: [],
    weapons: [],
    skills: [],
    domains: [],
    mounts: [],
    portrait: "",
    thumb: "",
  }],
  artifacts: [],
  relations: [],
} satisfies Dataset;

describe("applyCharacterImageOverrides", () => {
  it("updates only image fields for the matching branch character", () => {
    const result = applyCharacterImageOverrides(dataset, new Map([[
      "newcomer",
      {
        portrait: "/p/shuihu/branches/branch-a/portraits/newcomer.webp?v=1",
        thumb: "/p/shuihu/branches/branch-a/thumbs/newcomer.webp?v=1",
        ownerBranchId: "branch-a",
        version: "1",
      },
    ]]));

    expect(result.characters[0]).toEqual({
      ...dataset.characters[0],
      portrait: "/p/shuihu/branches/branch-a/portraits/newcomer.webp?v=1",
      thumb: "/p/shuihu/branches/branch-a/thumbs/newcomer.webp?v=1",
    });
    expect(result.characters[0].events).toBe(dataset.characters[0].events);
  });

  it("preserves dataset identity when no override applies", () => {
    expect(applyCharacterImageOverrides(dataset, new Map())).toBe(dataset);
  });
});
