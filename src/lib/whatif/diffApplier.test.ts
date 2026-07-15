/**
 * diffApplier 单元测试
 */
import { describe, it, expect } from "vitest";
import { applyDiff, normalizeDiffAgainstDataset, replayBranch } from "@/lib/whatif/diffApplier";
import type { Dataset, Character, Relation } from "@/schemas/character";
import type { GraphDiff, WhatIfTurnDetail } from "@/schemas/whatif";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    schema_version: 3,
    id: "test_char",
    name_zh: "测试人物",
    name_en: "Test Char",
    aliases: [],
    epithet: null,
    category: "liangshan",
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
    ...overrides,
  };
}

function makeRelation(overrides: Partial<Relation> = {}): Relation {
  return {
    schema_version: 3,
    id: "a-b",
    source: "a",
    target: "b",
    primary_type: "bond",
    composite_types: [],
    events: [],
    ...overrides,
  };
}

function makeDataset(chars: Character[] = [], rels: Relation[] = []): Dataset {
  return {
    schema_version: 3,
    characters: chars,
    artifacts: [],
    relations: rels,
  };
}

const emptyDiff: GraphDiff = {
  removedNodes: [],
  addedNodes: [],
  removedEdges: [],
  addedEdges: [],
  modifiedEvents: [],
  replacedEvents: [],
};

describe("applyDiff", () => {
  it("empty diff returns dataset with same characters (immutability)", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const result = applyDiff(base, emptyDiff);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].id).toBe("a");
  });

  it("removedNodes filters out characters by id", () => {
    const base = makeDataset([
      makeCharacter({ id: "a" }),
      makeCharacter({ id: "b" }),
      makeCharacter({ id: "c" }),
    ]);
    const diff: GraphDiff = { ...emptyDiff, removedNodes: ["a", "c"] };
    const result = applyDiff(base, diff);
    expect(result.characters.map((c) => c.id)).toEqual(["b"]);
  });

  it("addedNodes appends new characters", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const newChar = makeCharacter({ id: "b", name_zh: "B" });
    const diff: GraphDiff = { ...emptyDiff, addedNodes: [newChar] };
    const result = applyDiff(base, diff);
    expect(result.characters.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("addedNodes with existing id is deduped", () => {
    const base = makeDataset([makeCharacter({ id: "a", name_zh: "Original" })]);
    const dupChar = makeCharacter({ id: "a", name_zh: "Duplicate" });
    const diff: GraphDiff = { ...emptyDiff, addedNodes: [dupChar] };
    const result = applyDiff(base, diff);
    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].name_zh).toBe("Original");
  });

  it("removedEdges filters out relations by id", () => {
    const base = makeDataset(
      [makeCharacter({ id: "a" }), makeCharacter({ id: "b" })],
      [
        makeRelation({ id: "a-b", source: "a", target: "b" }),
        makeRelation({ id: "a-c", source: "a", target: "c" }),
      ],
    );
    const diff: GraphDiff = { ...emptyDiff, removedEdges: ["a-b"] };
    const result = applyDiff(base, diff);
    expect(result.relations).toHaveLength(1);
    expect(result.relations[0].id).toBe("a-c");
  });

  it("addedEdges appends new relations", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const newRel = makeRelation({ id: "a-b", source: "a", target: "b" });
    const diff: GraphDiff = { ...emptyDiff, addedEdges: [newRel] };
    const result = applyDiff(base, diff);
    expect(result.relations).toHaveLength(1);
  });

  it("modifiedEvents replaces event at given index", () => {
    const base = makeDataset([
      makeCharacter({
        id: "a",
        events: [
          { title: "事件1", desc: "原始1", source: null },
          { title: "事件2", desc: "原始2", source: null },
        ],
      }),
    ]);
    const diff: GraphDiff = {
      ...emptyDiff,
      modifiedEvents: [
        {
          characterId: "a",
          eventIndex: 1,
          newEvent: { title: "改写事件2", desc: "新内容", source: null },
        },
      ],
    };
    const result = applyDiff(base, diff);
    expect(result.characters[0].events[1].title).toBe("改写事件2");
    expect(result.characters[0].events[0].title).toBe("事件1"); // 未受影响
  });

  it("modifiedEvents with out-of-bounds index is skipped", () => {
    const base = makeDataset([
      makeCharacter({ id: "a", events: [] }),
    ]);
    const diff: GraphDiff = {
      ...emptyDiff,
      modifiedEvents: [
        {
          characterId: "a",
          eventIndex: 5,
          newEvent: { title: "X", desc: "Y", source: null },
        },
      ],
    };
    const result = applyDiff(base, diff);
    expect(result.characters[0].events).toHaveLength(0);
  });

  it("replacedEvents replaces all events of a character", () => {
    const base = makeDataset([
      makeCharacter({
        id: "a",
        events: [
          { title: "旧1", desc: "x", source: null },
          { title: "旧2", desc: "x", source: null },
          { title: "旧3", desc: "x", source: null },
        ],
      }),
    ]);
    const diff: GraphDiff = {
      ...emptyDiff,
      replacedEvents: [
        {
          characterId: "a",
          newEvents: [
            { title: "新1", desc: "x", source: null },
            { title: "新2", desc: "x", source: null },
          ],
        },
      ],
    };
    const result = applyDiff(base, diff);
    expect(result.characters[0].events).toHaveLength(2);
    expect(result.characters[0].events[0].title).toBe("新1");
  });

  it("does not mutate base dataset", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const originalChars = base.characters;
    const diff: GraphDiff = { ...emptyDiff, removedNodes: ["a"] };
    applyDiff(base, diff);
    expect(base.characters).toBe(originalChars); // same reference
    expect(base.characters).toHaveLength(1); // unchanged
  });
});

describe("normalizeDiffAgainstDataset", () => {
  it("marks replayed modified events as adaptations without mutating the stored diff", () => {
    const base = makeDataset([
      makeCharacter({
        id: "lin_chong",
        events: [{
          title: "火并王伦",
          desc: "原典事件",
          source: { work: "《水浒传》", locus: "第十九回", translator: null },
        }],
      }),
    ]);
    const diff: GraphDiff = {
      ...emptyDiff,
      modifiedEvents: [{
        characterId: "lin_chong",
        eventIndex: 0,
        newEvent: {
          title: "未火并王伦",
          desc: "改写事件",
          source: { work: "《水浒传》", locus: null, translator: null },
        },
      }],
    };

    const result = applyDiff(base, diff);

    expect(result.characters[0].events[0].source?.work).toBe("水浒传-改编");
    expect(diff.modifiedEvents[0].newEvent.source?.work).toBe("《水浒传》");
  });

  it("uses each generated event's corresponding work for added graph content", () => {
    const base = makeDataset([makeCharacter({
      id: "odysseus",
      events: [{
        title: "返乡",
        desc: "原典事件",
        source: { work: "《奥德赛》", locus: null, translator: null },
      }],
    })]);
    const addedCharacter = makeCharacter({
      id: "new_hero",
      name_zh: "新英雄",
      events: [{
        title: "新旅程",
        desc: "改写事件",
        source: { work: "《伊利亚特》", locus: null, translator: null },
      }],
    });
    const addedRelation = makeRelation({
      id: "new_hero-odysseus",
      source: "new_hero",
      target: "odysseus",
      events: [{
        title: "结盟",
        desc: "改写关系",
        source: { work: "奥德赛-改编", locus: null, translator: null },
        era_order: 0,
      }],
    });
    const diff: GraphDiff = {
      ...emptyDiff,
      addedNodes: [addedCharacter],
      addedEdges: [addedRelation],
    };

    const result = normalizeDiffAgainstDataset(base, diff);

    expect(result.addedNodes[0].events[0].source?.work).toBe("伊利亚特-改编");
    expect(result.addedEdges[0].events[0].source?.work).toBe("奥德赛-改编");
  });

  it("preserves canon citations for unchanged titles inside replacedEvents", () => {
    const base = makeDataset([
      makeCharacter({
        id: "lin_chong",
        events: [
          {
            title: "误入白虎堂",
            desc: "原典描述",
            source: { work: "《水浒传》", locus: "第七回", translator: null },
          },
          {
            title: "火并王伦",
            desc: "原典描述",
            source: { work: "水浒传", locus: "第十九回", translator: null },
          },
        ],
      }),
    ]);
    const diff: GraphDiff = {
      ...emptyDiff,
      replacedEvents: [{
        characterId: "lin_chong",
        newEvents: [
          {
            title: "误入白虎堂",
            desc: "模型重新概述，但仍是原典事件",
            source: { work: "水浒传", locus: null, translator: null },
          },
          {
            title: "未火并王伦",
            desc: "分支新增事件",
            source: { work: "水浒传", locus: null, translator: null },
          },
        ],
      }],
    };

    const result = normalizeDiffAgainstDataset(base, diff);
    const [canonEvent, adaptedEvent] = result.replacedEvents[0].newEvents;

    expect(canonEvent.source).toEqual({
      work: "水浒传",
      locus: "第七回",
      translator: null,
    });
    expect(adaptedEvent.source?.work).toBe("水浒传-改编");
  });

  it("removes existing characters and relations from LLM additions", () => {
    const existingCharacter = makeCharacter({ id: "gao_qiu", name_zh: "高俅" });
    const existingRelation = makeRelation({ id: "gao_qiu-song_jiang" });
    const base = makeDataset([existingCharacter], [existingRelation]);
    const diff: GraphDiff = {
      ...emptyDiff,
      addedNodes: [
        makeCharacter({ id: "gao_qiu", name_zh: "高俅（重复）" }),
        makeCharacter({ id: "new_general", name_zh: "新将领" }),
      ],
      addedEdges: [
        makeRelation({ id: "gao_qiu-song_jiang" }),
        makeRelation({ id: "new_general-song_jiang" }),
      ],
    };

    const result = normalizeDiffAgainstDataset(base, diff);

    expect(result.addedNodes.map((node) => node.id)).toEqual(["new_general"]);
    expect(result.addedEdges.map((edge) => edge.id)).toEqual(["new_general-song_jiang"]);
    expect(diff.addedNodes).toHaveLength(2);
  });
});

describe("replayBranch", () => {
  function makeTurn(order: number, diff: GraphDiff): WhatIfTurnDetail {
    return {
      id: `turn-${order}`,
      branchId: "branch-1",
      order,
      premise: "test",
      premiseType: "event_negative",
      sourceEventTitle: null,
      diff,
      narrative: [],
      choices: [],
      status: "completed",
      validation: null,
      createdAt: new Date(),
    };
  }

  it("empty turns returns base as-is", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const result = replayBranch(base, []);
    expect(result).toBe(base);
  });

  it("applies turns in order regardless of input order", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const turn1 = makeTurn(1, { ...emptyDiff, addedNodes: [makeCharacter({ id: "b" })] });
    const turn2 = makeTurn(2, { ...emptyDiff, addedNodes: [makeCharacter({ id: "c" })] });
    const result = replayBranch(base, [turn2, turn1]); // 逆序输入
    expect(result.characters.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("chains diffs cumulatively", () => {
    const base = makeDataset([makeCharacter({ id: "a" })]);
    const turn1 = makeTurn(1, { ...emptyDiff, addedNodes: [makeCharacter({ id: "b" })] });
    const turn2 = makeTurn(2, { ...emptyDiff, removedNodes: ["b"] });
    const result = replayBranch(base, [turn1, turn2]);
    expect(result.characters.map((c) => c.id)).toEqual(["a"]);
  });
});
