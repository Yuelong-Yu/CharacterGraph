import { buildTourSequence } from "./tourTraversal";

export interface MobileDeckNode {
  id: string;
}

export interface MobileDeckRelation {
  source: string;
  target: string;
}

export function buildMobileDeck<T extends MobileDeckNode>({
  nodes,
  relations,
}: {
  nodes: readonly T[];
  relations: readonly MobileDeckRelation[];
}): T[] {
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  for (const relation of relations) {
    if (degreeById.has(relation.source)) {
      degreeById.set(relation.source, (degreeById.get(relation.source) ?? 0) + 1);
    }
    if (degreeById.has(relation.target)) {
      degreeById.set(relation.target, (degreeById.get(relation.target) ?? 0) + 1);
    }
  }

  return buildTourSequence({
    nodes,
    relations,
    visibleIds: new Set(nodes.map((node) => node.id)),
    degreeById,
    mode: "breadth-first",
  });
}

export function filterMobileDeck<T extends MobileDeckNode>(
  deck: readonly T[],
  matchedIds: ReadonlySet<string> | null,
): T[] {
  if (!matchedIds) return [...deck];
  return deck.filter((node) => matchedIds.has(node.id));
}

export function moveInMobileDeck<T extends MobileDeckNode>(
  deck: readonly T[],
  currentId: string | null,
  direction: -1 | 1,
): T | null {
  if (deck.length === 0) return null;
  const currentIndex = currentId ? deck.findIndex((node) => node.id === currentId) : -1;
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  return deck[(baseIndex + direction + deck.length) % deck.length] ?? null;
}
