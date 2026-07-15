export interface GraphNodeVisibilityInput {
  nodeId: string;
  selectedNodeId?: string | null;
  bypassFilters: boolean;
  focusedId?: string | null;
  isFocusedNeighbor: boolean;
  categoryEnabled: boolean;
  degree: number;
  minDegree: number;
  matchesSearch: boolean;
}

/** Keeps graph selection and the detail panel visually consistent. */
export function isGraphNodeVisible({
  nodeId,
  selectedNodeId,
  bypassFilters,
  focusedId,
  isFocusedNeighbor,
  categoryEnabled,
  degree,
  minDegree,
  matchesSearch,
}: GraphNodeVisibilityInput): boolean {
  if (bypassFilters || nodeId === selectedNodeId) return true;
  if (focusedId) return nodeId === focusedId || isFocusedNeighbor;
  return categoryEnabled && degree >= minDegree && matchesSearch;
}
