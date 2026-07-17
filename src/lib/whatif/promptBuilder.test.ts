/**
 * promptBuilder parser 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  buildContinuationUserPrompt,
  buildSystemPrompt,
  parseLLMOutput,
  LLMParseError,
} from "@/lib/whatif/promptBuilder";
import type { GraphSubset } from "@/lib/whatif/contextBuilder";
import type { ClientProjectConfig } from "@/schemas/projectConfig";

function makeSubset(eventTitle: string): GraphSubset {
  return {
    core: {
      id: "song_jiang",
      name_zh: "宋江",
      name_en: "Song Jiang",
      aliases: [],
      epithet: null,
      category: "liangshan",
      era_layer: 1,
      bio: null,
      events: [{ title: eventTitle, desc: eventTitle, source: null }],
      quotes: [],
    },
    neighbors: [],
    secondDegree: [],
    artifacts: [],
  };
}

function makeNeighbor(
  id: string,
  name: string,
  relationType: string,
): GraphSubset["neighbors"][number] {
  return {
    id,
    name_zh: name,
    name_en: name,
    category: "liangshan",
    epithet: null,
    era_layer: 1,
    relation: {
      id: `song_jiang-${id}`,
      primary_type: relationType,
      composite_types: [],
      events: [],
    },
  };
}

const testConfig = {
  schema_version: 3,
  slug: "test",
  title: "Test",
  subtitle: null,
  searchPlaceholder: "搜索",
  order: 1,
  draft: false,
  zhSource: "baike",
  characterCategories: { liangshan: { label: "梁山", color: "#fff" } },
  artifactCategories: {},
  relationTypes: { ally: { label: "盟友", color: "#fff" } },
  eraLayers: {},
  nodeVisualTheme: "darkPortraits",
} satisfies ClientProjectConfig;

describe("parseLLMOutput", () => {
  it("parses strict format (=== separators)", () => {
    const raw = `===DIFF===
{
  "removedNodes": ["a"],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [],
  "replacedEvents": []
}
===NARRATIVE===
【原典】第一段
【推演】第二段
===CHOICES===
1. 选项一
2. 选项二`;
    const result = parseLLMOutput(raw);
    expect(result.diff.removedNodes).toEqual(["a"]);
    expect(result.narrative).toHaveLength(2);
    expect(result.narrative[0].label).toBe("原典");
    expect(result.narrative[0].text).toBe("第一段");
    expect(result.choices).toEqual(["选项一", "选项二"]);
  });

  it("parses established branch facts with the 假设 label", () => {
    const raw = `===DIFF===
{"removedNodes":[],"addedNodes":[],"removedEdges":[],"addedEdges":[],"modifiedEvents":[],"replacedEvents":[]}
===NARRATIVE===
【假设】上一轮中卢俊义已经拒绝招安。
【推演】因此本轮梁山改变了应战策略。
===CHOICES===
1. 继续推演`;

    const result = parseLLMOutput(raw);

    expect(result.narrative[0].label).toBe("假设");
    expect(result.narrative[0].text).toContain("上一轮");
  });

  it("parses lenient format (```json fence + 【】 lines)", () => {
    const raw = `some preamble
\`\`\`json
{
  "removedNodes": ["x"],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [],
  "replacedEvents": []
}
\`\`\`
some text
【原典】叙事内容
【推演】推演内容
1. 选项一
2. 选项二`;
    const result = parseLLMOutput(raw);
    expect(result.diff.removedNodes).toEqual(["x"]);
    expect(result.narrative).toHaveLength(2);
    expect(result.choices).toEqual(["选项一", "选项二"]);
  });

  it("throws LLMParseError on invalid JSON in diff", () => {
    const raw = `===DIFF===
{invalid json}
===NARRATIVE===
【原典】x
===CHOICES===
1. y`;
    expect(() => parseLLMOutput(raw)).toThrow(LLMParseError);
  });

  it("throws when no narrative segments found", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [],
  "replacedEvents": []
}
===NARRATIVE===
no labels here
===CHOICES===
1. x`;
    expect(() => parseLLMOutput(raw)).toThrow(LLMParseError);
  });

  it("sanitizer: null source.work becomes source=null", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [
    {
      "characterId": "a",
      "eventIndex": 0,
      "newEvent": {
        "title": "x",
        "desc": "y",
        "source": {"work": null, "locus": null, "translator": null}
      }
    }
  ],
  "replacedEvents": []
}
===NARRATIVE===
【原典】x
===CHOICES===
1. y`;
    const result = parseLLMOutput(raw);
    expect(result.diff.modifiedEvents[0].newEvent.source).toBeNull();
  });

  it("sanitizer: array newEvent becomes replacedEvents", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [
    {
      "characterId": "a",
      "eventIndex": 0,
      "newEvent": [
        {"title": "新1", "desc": "x", "source": null},
        {"title": "新2", "desc": "x", "source": null}
      ]
    }
  ],
  "replacedEvents": []
}
===NARRATIVE===
【原典】x
===CHOICES===
1. y`;
    const result = parseLLMOutput(raw);
    expect(result.diff.modifiedEvents).toHaveLength(0);
    expect(result.diff.replacedEvents).toHaveLength(1);
    expect(result.diff.replacedEvents[0].newEvents).toHaveLength(2);
  });

  it("sanitizer: nested replacedEvents becomes newEvents", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [],
  "replacedEvents": [
    {
      "characterId": "song_jiang",
      "replacedEvents": [
        {"title": "改写1", "desc": "x", "source": null},
        {"title": "改写2", "desc": "y", "source": null}
      ]
    }
  ]
}
===NARRATIVE===
【推演】宋江走上另一条时间线。
===CHOICES===
1. 继续`;

    const result = parseLLMOutput(raw);

    expect(result.diff.replacedEvents).toEqual([
      {
        characterId: "song_jiang",
        newEvents: [
          { title: "改写1", desc: "x", source: null },
          { title: "改写2", desc: "y", source: null },
        ],
      },
    ]);
  });

  it("sanitizer: negative eventIndex is filtered", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [
    {"characterId": "a", "eventIndex": -1, "newEvent": {"title": "x", "desc": "y", "source": null}},
    {"characterId": "a", "eventIndex": 0, "newEvent": {"title": "valid", "desc": "y", "source": null}}
  ],
  "replacedEvents": []
}
===NARRATIVE===
【原典】x
===CHOICES===
1. y`;
    const result = parseLLMOutput(raw);
    expect(result.diff.modifiedEvents).toHaveLength(1);
    expect(result.diff.modifiedEvents[0].eventIndex).toBe(0);
  });

  it("sanitizer: composite_types null becomes []", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [
    {
      "schema_version": 3,
      "id": "a-b",
      "source": "a",
      "target": "b",
      "primary_type": "bond",
      "composite_types": null,
      "events": []
    }
  ],
  "modifiedEvents": [],
  "replacedEvents": []
}
===NARRATIVE===
【原典】x
===CHOICES===
1. y`;
    const result = parseLLMOutput(raw);
    expect(result.diff.addedEdges[0].composite_types).toEqual([]);
  });

  it("sanitizer: invalid canon value (e.g. 推演) becomes null", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [
    {
      "schema_version": 3,
      "id": "a-b",
      "source": "a",
      "target": "b",
      "primary_type": "bond",
      "composite_types": [],
      "events": [
        {
          "title": "x",
          "desc": "y",
          "desc_long": null,
          "source": {"work": "《水浒传》", "locus": null, "translator": null},
          "canon": "推演",
          "era_order": 0
        }
      ]
    }
  ],
  "modifiedEvents": [
    {
      "characterId": "a",
      "eventIndex": 0,
      "newEvent": {
        "title": "x",
        "desc": "y",
        "source": {"work": "《水浒传》", "locus": null, "translator": null},
        "canon": "原典"
      }
    }
  ],
  "replacedEvents": []
}
===NARRATIVE===
【原典】x
===CHOICES===
1. y`;
    const result = parseLLMOutput(raw);
    expect(result.diff.addedEdges[0].events[0].canon).toBeNull();
    expect(result.diff.modifiedEvents[0].newEvent.canon).toBeNull();
  });

  it("strips '数字.' prefix from choices", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": [],
  "removedEdges": [],
  "addedEdges": [],
  "modifiedEvents": [],
  "replacedEvents": []
}
===NARRATIVE===
【原典】x
===CHOICES===
1) 第一项
- 第二项
3. 第三项`;
    const result = parseLLMOutput(raw);
    expect(result.choices).toEqual(["第一项", "第二项", "第三项"]);
  });
});

describe("multi-turn prompt provenance", () => {
  it("separates immutable canon from a compact current branch delta", () => {
    const canonicalSubset = makeSubset("原典事件");
    canonicalSubset.core.bio = "这段不可变原典简介只能出现一次";
    const branchSubset = makeSubset("上一轮杜撰事件");
    branchSubset.core.bio = canonicalSubset.core.bio;

    const prompt = buildSystemPrompt(canonicalSubset, testConfig, {
      branchSubset,
      knownCharacters: [{ id: "gao_qiu", name_zh: "高俅" }],
    });

    expect(prompt).toContain("# 不可变原典图谱子集");
    expect(prompt).toContain("# 当前分支相对原典的变化（假设）");
    expect(prompt).toContain("原典事件");
    expect(prompt).toContain("上一轮杜撰事件");
    expect(prompt.match(/这段不可变原典简介只能出现一次/g)).toHaveLength(1);
    expect(prompt).toContain('"core"');
    expect(prompt).toContain('"changes"');
    expect(prompt).toContain("只有不可变原典图谱子集");
    expect(prompt).toContain("gao_qiu:高俅");
    expect(prompt).toContain("source.work 必须写成对应的“著作名-改编”");
  });

  it("describes collection additions, removals, and modifications in the branch delta", () => {
    const canonicalSubset = makeSubset("原典事件");
    canonicalSubset.neighbors = [
      makeNeighbor("wu_yong", "吴用", "ally"),
      makeNeighbor("lin_chong", "林冲", "ally"),
    ];
    const branchSubset = makeSubset("原典事件");
    branchSubset.neighbors = [
      makeNeighbor("wu_yong", "吴用", "rival"),
      makeNeighbor("lu_junyi", "卢俊义", "ally"),
    ];

    const prompt = buildSystemPrompt(canonicalSubset, testConfig, { branchSubset });

    expect(prompt).toContain('"neighbors"');
    expect(prompt).toContain('"added"');
    expect(prompt).toContain('"lu_junyi"');
    expect(prompt).toContain('"removedIds"');
    expect(prompt).toContain('"lin_chong"');
    expect(prompt).toContain('"modified"');
    expect(prompt).toContain('"primary_type": "rival"');
  });

  it("feeds every prior narrative to the next turn as 假设", () => {
    const prompt = buildContinuationUserPrompt(
      {
        characterId: "song_jiang",
        characterName: "宋江",
        eventTitle: "私放晁盖",
        premise: "宋江没有私放晁盖",
        premiseType: "event_negative",
      },
      [{
        premise: "宋江没有私放晁盖",
        narrative: [
          { label: "原典", text: "宋江原本私放晁盖。" },
          { label: "推演", text: "晁盖转而逃往别处。" },
          { label: "杜撰", text: "卢俊义拒绝招安。" },
        ],
      }],
      "继续攻打高俅",
    );

    expect(prompt).toContain("【假设】宋江原本私放晁盖。");
    expect(prompt).toContain("【假设】晁盖转而逃往别处。");
    expect(prompt).toContain("【假设】卢俊义拒绝招安。");
    expect(prompt).not.toContain("【原典】宋江原本私放晁盖。");
    expect(prompt).not.toContain("【杜撰】卢俊义拒绝招安。");
  });
});
