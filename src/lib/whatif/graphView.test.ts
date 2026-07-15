import { describe, expect, it } from "vitest";
import { buildWhatIfGraphView, resolveNodeChange } from "@/lib/whatif/graphView";
import type { Character, Dataset, Relation } from "@/schemas/character";
import type { GraphDiff, WhatIfTurnDetail } from "@/schemas/whatif";

function makeCharacter(id: string): Character {
  return {
    schema_version: 3,
    id,
    name_zh: id.toUpperCase(),
    name_en: id,
    aliases: [],
    epithet: null,
    category: "hero",
    era_layer: 1,
    bio: null,
    events: [{ title: "原事件", desc: "原事件", source: null }],
    quotes: [],
    weapons: [],
    skills: [],
    domains: [],
    mounts: [],
    portrait: "",
    thumb: "",
  };
}

function makeRelation(id: string, source: string, target: string): Relation {
  return {
    schema_version: 3,
    id,
    source,
    target,
    primary_type: "bond",
    composite_types: [],
    events: [],
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
    createdAt: new Date(order),
  };
}

const base: Dataset = {
  schema_version: 3,
  characters: ["a", "b", "c", "d"].map(makeCharacter),
  artifacts: [],
  relations: [
    makeRelation("a-b", "a", "b"),
    makeRelation("b-c", "b", "c"),
    makeRelation("c-d", "c", "d"),
  ],
};

describe("buildWhatIfGraphView", () => {
  it("shows changed nodes, their direct neighbors, and only incident edges", () => {
    const added = makeCharacter("newcomer");
    const turn = makeTurn(1, {
      ...emptyDiff,
      removedNodes: ["b"],
      addedNodes: [added],
      addedEdges: [makeRelation("newcomer-c", "newcomer", "c")],
      modifiedEvents: [
        {
          characterId: "a",
          eventIndex: 0,
          newEvent: { title: "改写事件", desc: "改写事件", source: null },
        },
      ],
    });

    const result = buildWhatIfGraphView(base, [turn]);

    expect(result.dataset.characters.map((node) => node.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "newcomer",
    ]);
    expect(result.dataset.relations.map((edge) => edge.id).sort()).toEqual([
      "a-b",
      "b-c",
      "newcomer-c",
    ]);
    expect(result.nodeChanges).toEqual(
      new Map([
        ["a", "modified"],
        ["b", "removed"],
        ["newcomer", "added"],
      ]),
    );
    expect(result.dataset.characters.find((node) => node.id === "a")?.events[0].title).toBe(
      "改写事件",
    );
  });

  it("keeps an added node red after a later event modification", () => {
    const turn1 = makeTurn(1, {
      ...emptyDiff,
      addedNodes: [makeCharacter("newcomer")],
      addedEdges: [makeRelation("newcomer-a", "newcomer", "a")],
    });
    const turn2 = makeTurn(2, {
      ...emptyDiff,
      modifiedEvents: [
        {
          characterId: "newcomer",
          eventIndex: 0,
          newEvent: { title: "后来改写", desc: "后来改写", source: null },
        },
      ],
    });

    const result = buildWhatIfGraphView(base, [turn1, turn2]);

    expect(result.nodeChanges.get("newcomer")).toBe("added");
    expect(result.dataset.characters.map((node) => node.id).sort()).toEqual(["a", "newcomer"]);
  });

  it("keeps a locally added node red when a WhatIf turn modifies it", () => {
    expect(resolveNodeChange(
      "user-character",
      new Map([["user-character", "modified"]]),
      new Set(["user-character"]),
    )).toBe("added");
  });

  it("keeps deletion grey above the locally added red style", () => {
    expect(resolveNodeChange(
      "user-character",
      new Map([["user-character", "removed"]]),
      new Set(["user-character"]),
    )).toBe("removed");
  });

  it("shows both endpoints when a turn only adds a relationship", () => {
    const edgeOnlyBase = { ...base, relations: [] };
    const turn = makeTurn(1, {
      ...emptyDiff,
      addedEdges: [makeRelation("a-c", "a", "c")],
    });

    const result = buildWhatIfGraphView(edgeOnlyBase, [turn]);

    expect(result.dataset.characters.map((node) => node.id).sort()).toEqual(["a", "c"]);
    expect(result.dataset.relations.map((edge) => edge.id)).toEqual(["a-c"]);
  });

  it("does not revive an explicitly removed edge for a removed-node tombstone", () => {
    const turn = makeTurn(1, {
      ...emptyDiff,
      removedNodes: ["b"],
      removedEdges: ["a-b"],
    });

    const result = buildWhatIfGraphView(base, [turn]);

    expect(result.dataset.relations.map((edge) => edge.id)).toEqual(["b-c"]);
    expect(result.dataset.characters.map((node) => node.id).sort()).toEqual(["b", "c"]);
  });

  it("preserves an established relationship when a later scene still has the pair cooperating", () => {
    const edgeOnlyBase = { ...base, relations: [] };
    const establish = makeTurn(1, {
      ...emptyDiff,
      addedEdges: [makeRelation("a-b", "a", "b")],
    });
    const contradictoryRemoval = {
      ...makeTurn(2, {
        ...emptyDiff,
        removedEdges: ["a-b"],
      }),
      premise: "A带B返回酒店会合，继续共同商议后续安排。",
      narrative: [
        { text: "A与B一同抵达酒店，继续合作。", label: "推演" as const, citation: null, characterIds: [] },
      ],
    };

    const result = buildWhatIfGraphView(edgeOnlyBase, [establish, contradictoryRemoval]);

    expect(result.dataset.relations.map((edge) => edge.id)).toEqual(["a-b"]);
  });

  it("removes an established relationship when the story explicitly says both parties break ties", () => {
    const namedBase = {
      ...base,
      relations: [makeRelation("a-b", "a", "b")],
    };
    const rupture = {
      ...makeTurn(1, {
        ...emptyDiff,
        removedEdges: ["a-b"],
      }),
      narrative: [
        { text: "A与B彻底决裂，宣布断绝往来。", label: "推演" as const, citation: null, characterIds: [] },
      ],
    };

    const result = buildWhatIfGraphView(namedBase, [rupture]);

    expect(result.dataset.relations).toEqual([]);
  });

  it("shows the complete branch graph when the change panel is hidden", () => {
    const turn = makeTurn(1, {
      ...emptyDiff,
      removedNodes: ["b"],
      addedNodes: [makeCharacter("newcomer")],
      addedEdges: [makeRelation("newcomer-c", "newcomer", "c")],
      modifiedEvents: [
        {
          characterId: "a",
          eventIndex: 0,
          newEvent: { title: "改写事件", desc: "改写事件", source: null },
        },
      ],
    });

    const result = buildWhatIfGraphView(base, [turn], { scope: "all" });

    expect(result.dataset.characters.map((node) => node.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "newcomer",
    ]);
    expect(result.dataset.relations.map((edge) => edge.id).sort()).toEqual([
      "a-b",
      "b-c",
      "c-d",
      "newcomer-c",
    ]);
    expect(result.nodeChanges).toEqual(
      new Map([
        ["a", "modified"],
        ["b", "removed"],
        ["newcomer", "added"],
      ]),
    );
  });
});
