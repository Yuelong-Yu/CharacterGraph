/**
 * validation 单元测试
 */
import { describe, it, expect } from "vitest";
import { validateNarrative } from "@/lib/whatif/validation";
import type { Dataset, Character } from "@/schemas/character";
import type { GraphDiff, NarrativeSegment } from "@/schemas/whatif";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    schema_version: 3,
    id: "song_jiang",
    name_zh: "宋江",
    name_en: "Song Jiang",
    aliases: ["及时雨"],
    epithet: null,
    category: "liangshan",
    era_layer: 1,
    bio: null,
    events: [
      {
        title: "怒杀阎婆惜",
        desc: "...",
        source: { work: "《水浒传》", locus: null, translator: null },
      },
    ],
    quotes: [],
    weapons: [],
    skills: [],
    domains: [],
    mounts: [],
    portrait: "",
    thumb: "",
    ...overrides,
  };
}

function makeDataset(chars: Character[] = []): Dataset {
  return { schema_version: 3, characters: chars, artifacts: [], relations: [] };
}

const emptyDiff: GraphDiff = {
  removedNodes: [],
  addedNodes: [],
  removedEdges: [],
  addedEdges: [],
  modifiedEvents: [],
  replacedEvents: [],
};

function makeSeg(text: string, label: "原典" | "假设" | "推演" | "杜撰", citation?: NarrativeSegment["citation"]): NarrativeSegment {
  return { text, label, citation: citation ?? null, characterIds: [] };
}

describe("validateNarrative", () => {
  it("empty narrative returns no results", () => {
    const ds = makeDataset([makeCharacter()]);
    const result = validateNarrative([], ds, emptyDiff);
    expect(result).toHaveLength(0);
  });

  it("【原典】 with valid citation work passes", () => {
    const ds = makeDataset([makeCharacter()]);
    const narrative = [
      makeSeg("宋江杀阎婆惜", "原典", { work: "《水浒传》", locus: null, translator: null }),
    ];
    const result = validateNarrative(narrative, ds, emptyDiff);
    expect(result).toHaveLength(0);
  });

  it("【原典】 with invalid citation work produces error", () => {
    const ds = makeDataset([makeCharacter()]);
    const narrative = [
      makeSeg("宋江杀阎婆惜", "原典", { work: "《虚构典》", locus: null, translator: null }),
    ];
    const result = validateNarrative(narrative, ds, emptyDiff);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("error");
    expect(result[0].message).toContain("《虚构典》");
  });

  it("【原典】 mentioning addedNode character produces error", () => {
    const ds = makeDataset([makeCharacter()]);
    const newChar = makeCharacter({ id: "new_char", name_zh: "新人物" });
    const diff: GraphDiff = { ...emptyDiff, addedNodes: [newChar] };
    const narrative = [
      makeSeg("新人物做了某事", "原典", { work: "《水浒传》", locus: null, translator: null }),
    ];
    const result = validateNarrative(narrative, ds, diff);
    expect(result.some((r) => r.level === "error" && r.message.includes("新人物"))).toBe(true);
  });

  it("keeps characters added by prior turns as 假设 rather than 原典", () => {
    const ds = makeDataset([makeCharacter()]);
    const priorAdded = makeCharacter({ id: "branch_general", name_zh: "分支将领" });
    const priorDiff: GraphDiff = { ...emptyDiff, addedNodes: [priorAdded] };
    const narrative = [
      makeSeg("分支将领此前已经加入梁山", "原典"),
      makeSeg("分支将领此前已经加入梁山", "假设"),
    ];

    const result = validateNarrative(narrative, ds, emptyDiff, [priorDiff]);

    expect(result).toHaveLength(1);
    expect(result[0].segmentIndex).toBe(0);
    expect(result[0].message).toContain("当前分支新增");
  });

  it("【推演】 with citation produces warning", () => {
    const ds = makeDataset([makeCharacter()]);
    const narrative = [
      makeSeg("宋江可能选择逃亡", "推演", { work: "《水浒传》", locus: null, translator: null }),
    ];
    const result = validateNarrative(narrative, ds, emptyDiff);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("warning");
    expect(result[0].message).toContain("推演");
  });

  it("【杜撰】 segments are not flagged for citation", () => {
    const ds = makeDataset([makeCharacter()]);
    const narrative = [
      makeSeg("宋江穿越到现代", "杜撰", { work: "《虚构典》", locus: null, translator: null }),
    ];
    const result = validateNarrative(narrative, ds, emptyDiff);
    expect(result).toHaveLength(0); // 杜撰允许任意引用
  });

  it("multiple segments produce multiple results", () => {
    const ds = makeDataset([makeCharacter()]);
    const narrative = [
      makeSeg("原文1", "原典", { work: "《虚构》", locus: null, translator: null }), // error
      makeSeg("推演1", "推演", { work: "《水浒传》", locus: null, translator: null }), // warning
      makeSeg("原文2", "原典", { work: "《水浒传》", locus: null, translator: null }), // ok
    ];
    const result = validateNarrative(narrative, ds, emptyDiff);
    expect(result).toHaveLength(2);
    expect(result[0].segmentIndex).toBe(0);
    expect(result[1].segmentIndex).toBe(1);
  });

  it("alias-based mention works (及时雨 matches 宋江)", () => {
    const ds = makeDataset([makeCharacter()]);
    const newChar = makeCharacter({ id: "new", name_zh: "新人" });
    const diff: GraphDiff = { ...emptyDiff, addedNodes: [newChar] };
    // 提到「及时雨」（宋江别名）+「新人」（newChar）
    const narrative = [
      makeSeg("及时雨遇见新人", "原典", { work: "《水浒传》", locus: null, translator: null }),
    ];
    const result = validateNarrative(narrative, ds, diff);
    // 新人是 addedNodes 里的，原典提到新人 -> error
    expect(result.some((r) => r.message.includes("新人"))).toBe(true);
  });
});
