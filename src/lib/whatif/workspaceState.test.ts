import { describe, expect, it } from "vitest";
import {
  launchConfigFromSession,
  whatIfWorkspaceReducer,
} from "@/lib/whatif/workspaceState";
import type { WhatIfSessionDetail, WhatIfTurnDetail } from "@/schemas/whatif";

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
    const state = { config, turns: [turn], panelOpen: true, activeBranchId: "branch-1" };

    const result = whatIfWorkspaceReducer(state, {
      type: "set-turns",
      turns: [turn],
    });

    expect(result).toBe(state);
  });

  it("keeps the active branch version when the panel is hidden", () => {
    const hidden = whatIfWorkspaceReducer(
      { config, turns: [turn], panelOpen: true, activeBranchId: "branch-1" },
      { type: "hide-panel" },
    );

    expect(hidden).toEqual({ config, turns: [turn], panelOpen: false, activeBranchId: "branch-1" });

    const reopened = whatIfWorkspaceReducer(hidden, { type: "show-panel" });
    expect(reopened).toEqual({ config, turns: [turn], panelOpen: true, activeBranchId: "branch-1" });
  });

  it("clears the branch version only when explicitly exiting", () => {
    const result = whatIfWorkspaceReducer(
      { config, turns: [turn], panelOpen: false, activeBranchId: "branch-1" },
      { type: "exit" },
    );

    expect(result).toEqual({ config: null, turns: [], panelOpen: false, activeBranchId: null });
  });

  it("reconstructs a launch config when opening a private branch", () => {
    const session = {
      id: "session-1",
      projectSlug: "shuihu",
      characterId: "lin_chong",
      title: "林冲 - 火并王伦",
      status: "active",
      branches: [{
        id: "branch-1",
        sessionId: "session-1",
        parentTurnId: null,
        title: "主时间线",
        isActive: true,
        turns: [{
          ...turn,
          premise: "如果林冲没有「火并王伦」",
          premiseType: "event_negative",
          sourceEventTitle: "火并王伦",
        }],
        createdAt: new Date(),
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WhatIfSessionDetail;

    expect(launchConfigFromSession(session, "林冲")).toEqual(config);
  });
});
