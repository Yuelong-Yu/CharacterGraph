import { describe, expect, it } from "vitest";
import { isGraphNodeVisible } from "@/lib/graphVisibility";

const defaults = {
  nodeId: "new-character",
  selectedNodeId: null,
  bypassFilters: false,
  focusedId: null,
  isFocusedNeighbor: false,
  categoryEnabled: true,
  degree: 3,
  minDegree: 0,
  matchesSearch: true,
};

describe("isGraphNodeVisible", () => {
  it("keeps the detail-panel selection visible through every graph filter", () => {
    expect(isGraphNodeVisible({
      ...defaults,
      selectedNodeId: "new-character",
      categoryEnabled: false,
      degree: 0,
      minDegree: 4,
      matchesSearch: false,
    })).toBe(true);
  });

  it("keeps focus mode limited to the focused node and its direct neighbors", () => {
    expect(isGraphNodeVisible({ ...defaults, focusedId: "another", isFocusedNeighbor: true })).toBe(true);
    expect(isGraphNodeVisible({ ...defaults, focusedId: "another", isFocusedNeighbor: false })).toBe(false);
  });

  it("applies category, degree, and search filters in the normal view", () => {
    expect(isGraphNodeVisible({ ...defaults, degree: 0, minDegree: 1 })).toBe(false);
    expect(isGraphNodeVisible({ ...defaults, matchesSearch: false })).toBe(false);
    expect(isGraphNodeVisible(defaults)).toBe(true);
  });
});
