import { describe, expect, it } from "vitest";
import { whatIfWorkspaceReducer } from "@/lib/whatif/workspaceState";
import type { WhatIfTurnDetail } from "@/schemas/whatif";

const config = {
  projectSlug: "shuihu",
  characterId: "lin_chong",
  characterName: "林冲",
  eventTitle: "火并王伦",
  premise: "如果林冲没有「火并王伦」",
  premiseType: "event_negative" as const,
};

const turn = { id: "turn-1" } as WhatIfTurnDetail;

describe("whatIfWorkspaceReducer", () => {
  it("ignores a new turns array containing the same turn objects", () => {
    const state = { config, turns: [turn], panelOpen: true };

    const result = whatIfWorkspaceReducer(state, {
      type: "set-turns",
      turns: [turn],
    });

    expect(result).toBe(state);
  });

  it("keeps the active branch version when the panel is hidden", () => {
    const hidden = whatIfWorkspaceReducer(
      { config, turns: [turn], panelOpen: true },
      { type: "hide-panel" },
    );

    expect(hidden).toEqual({ config, turns: [turn], panelOpen: false });

    const reopened = whatIfWorkspaceReducer(hidden, { type: "show-panel" });
    expect(reopened).toEqual({ config, turns: [turn], panelOpen: true });
  });

  it("clears the branch version only when explicitly exiting", () => {
    const result = whatIfWorkspaceReducer(
      { config, turns: [turn], panelOpen: false },
      { type: "exit" },
    );

    expect(result).toEqual({ config: null, turns: [], panelOpen: false });
  });
});
