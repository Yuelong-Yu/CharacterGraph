import { describe, expect, it } from "vitest";
import { affectedTurnIds, turnReferencesCharacter } from "@/lib/whatif/historyImpact";
import type { GraphDiff, NarrativeSegment } from "@/schemas/whatif";

const emptyDiff: GraphDiff = {
  removedNodes: [],
  addedNodes: [],
  removedEdges: [],
  addedEdges: [],
  modifiedEvents: [],
  replacedEvents: [],
};

describe("structured history impact", () => {
  it("uses character ids in diffs and narratives instead of name matching", () => {
    expect(turnReferencesCharacter({
      diff: emptyDiff,
      narrative: [{ text: "沈砚只是同名文字", label: "推演", characterIds: [] }],
    }, "shen_yan")).toBe(false);

    expect(turnReferencesCharacter({
      diff: { ...emptyDiff, removedNodes: ["shen_yan"] },
      narrative: [] as NarrativeSegment[],
    }, "shen_yan")).toBe(true);
  });

  it("marks the first referencing turn and every downstream turn as affected", () => {
    const turns: Array<{ id: string; diff: GraphDiff; narrative: NarrativeSegment[] }> = [
      { id: "turn-1", diff: emptyDiff, narrative: [] },
      { id: "turn-2", diff: emptyDiff, narrative: [{ text: "出现", label: "推演", characterIds: ["shen_yan"] }] },
      { id: "turn-3", diff: emptyDiff, narrative: [] },
    ];

    expect(affectedTurnIds(turns, "shen_yan")).toEqual(["turn-2", "turn-3"]);
  });
});
