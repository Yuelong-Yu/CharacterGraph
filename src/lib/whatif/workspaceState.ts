import type { PremiseType, WhatIfTurnDetail } from "@/schemas/whatif";

export interface WhatIfLaunchConfig {
  projectSlug: string;
  characterId: string;
  characterName: string;
  eventTitle: string | null;
  premise: string;
  premiseType: PremiseType;
}

export interface WhatIfWorkspaceState {
  config: WhatIfLaunchConfig | null;
  turns: WhatIfTurnDetail[];
  panelOpen: boolean;
  activeBranchId: string | null;
}

export const initialWhatIfWorkspaceState: WhatIfWorkspaceState = {
  config: null,
  turns: [],
  panelOpen: false,
  activeBranchId: null,
};

export type WhatIfWorkspaceAction =
  | { type: "launch"; config: WhatIfLaunchConfig }
  | { type: "set-turns"; turns: WhatIfTurnDetail[] }
  | { type: "set-active-branch"; branchId: string | null }
  | { type: "hide-panel" }
  | { type: "show-panel" }
  | { type: "exit" };

export function whatIfWorkspaceReducer(
  state: WhatIfWorkspaceState,
  action: WhatIfWorkspaceAction,
): WhatIfWorkspaceState {
  switch (action.type) {
    case "launch":
      return { config: action.config, turns: [], panelOpen: true, activeBranchId: null };
    case "set-turns": {
      const unchanged =
        state.turns.length === action.turns.length &&
        state.turns.every((turn, index) => turn === action.turns[index]);
      if (unchanged) return state;
      return { ...state, turns: action.turns };
    }
    case "hide-panel":
      return { ...state, panelOpen: false };
    case "show-panel":
      return state.config ? { ...state, panelOpen: true } : state;
    case "set-active-branch":
      return state.activeBranchId === action.branchId
        ? state
        : { ...state, activeBranchId: action.branchId };
    case "exit":
      return initialWhatIfWorkspaceState;
  }
}
