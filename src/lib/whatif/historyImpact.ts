import type { GraphDiff, NarrativeSegment } from "@/schemas/whatif";

export interface StructuredTurnReference {
  id?: string;
  diff: GraphDiff;
  narrative: NarrativeSegment[];
}

export function turnReferencesCharacter(
  turn: StructuredTurnReference,
  characterId: string,
): boolean {
  if (turn.diff.removedNodes.includes(characterId)) return true;
  if (turn.diff.addedNodes.some((character) => character.id === characterId)) return true;
  if (turn.diff.modifiedEvents.some((change) => change.characterId === characterId)) return true;
  if (turn.diff.replacedEvents.some((change) => change.characterId === characterId)) return true;
  if (turn.diff.addedEdges.some((relation) => (
    relation.source === characterId || relation.target === characterId
  ))) return true;
  return turn.narrative.some((segment) => segment.characterIds.includes(characterId));
}

export function affectedTurnIds<T extends StructuredTurnReference & { id: string }>(
  turns: readonly T[],
  characterId: string,
): string[] {
  const firstIndex = turns.findIndex((turn) => turnReferencesCharacter(turn, characterId));
  return firstIndex < 0 ? [] : turns.slice(firstIndex).map((turn) => turn.id);
}
