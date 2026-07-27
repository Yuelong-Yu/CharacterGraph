export type TourTraversalMode = "breadth-first" | "depth-first";

interface TourNode {
  id: string;
}

interface TourRelation {
  source: string;
  target: string;
}

interface BuildTourSequenceOptions<T extends TourNode> {
  nodes: readonly T[];
  relations: readonly TourRelation[];
  visibleIds: ReadonlySet<string>;
  degreeById: ReadonlyMap<string, number>;
  mode: TourTraversalMode;
}

function compareNodeIds(
  a: string,
  b: string,
  degreeById: ReadonlyMap<string, number>,
) {
  const degreeDifference = (degreeById.get(b) ?? 0) - (degreeById.get(a) ?? 0);
  return degreeDifference || a.localeCompare(b);
}

export function buildTourSequence<T extends TourNode>({
  nodes,
  relations,
  visibleIds,
  degreeById,
  mode,
}: BuildTourSequenceOptions<T>): T[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const relation of relations) {
    adjacency.get(relation.source)?.add(relation.target);
    adjacency.get(relation.target)?.add(relation.source);
  }

  const seeds = nodes
    .filter((node) => visibleIds.has(node.id))
    .map((node) => node.id)
    .sort((a, b) => compareNodeIds(a, b, degreeById));

  const visited = new Set<string>();
  const sequence: T[] = [];

  for (const seed of seeds) {
    if (visited.has(seed)) continue;

    if (mode === "breadth-first") {
      const queue = [seed];
      visited.add(seed);
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const id = queue[cursor];
        const node = nodeById.get(id);
        if (node) sequence.push(node);

        const neighbors = Array.from(adjacency.get(id) ?? [])
          .filter((neighborId) => visibleIds.has(neighborId) && !visited.has(neighborId))
          .sort((a, b) => compareNodeIds(a, b, degreeById));
        for (const neighborId of neighbors) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
      continue;
    }

    const stack = [seed];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id) || !visibleIds.has(id)) continue;
      visited.add(id);
      const node = nodeById.get(id);
      if (node) sequence.push(node);

      const neighbors = Array.from(adjacency.get(id) ?? [])
        .filter((neighborId) => visibleIds.has(neighborId) && !visited.has(neighborId))
        .sort((a, b) => compareNodeIds(a, b, degreeById));
      for (let index = neighbors.length - 1; index >= 0; index -= 1) {
        stack.push(neighbors[index]);
      }
    }
  }

  return sequence;
}
