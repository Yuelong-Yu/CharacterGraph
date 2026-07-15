import type { Artifact, Character, Dataset } from "@/schemas/character";
import type { WhatIfTurnDetail } from "@/schemas/whatif";
import { applyDiff, normalizeDiffAgainstDataset } from "./diffApplier";

export type WhatIfNodeChange = "added" | "modified" | "removed";

export interface WhatIfGraphView {
  dataset: Dataset;
  nodeChanges: Map<string, WhatIfNodeChange>;
}

export function resolveNodeChange(
  nodeId: string,
  whatIfNodeChanges: ReadonlyMap<string, WhatIfNodeChange> | null | undefined,
  userAddedNodeIds: ReadonlySet<string> | undefined,
): WhatIfNodeChange | undefined {
  const whatIfChange = whatIfNodeChanges?.get(nodeId);
  if (whatIfChange === "removed") return "removed";
  if (userAddedNodeIds?.has(nodeId)) return "added";
  return whatIfChange;
}

interface WhatIfGraphViewOptions {
  scope?: "changes" | "all";
}

type GraphEntity = Character | Artifact;

function entitiesById(dataset: Dataset): Map<string, GraphEntity> {
  return new Map(
    [...dataset.characters, ...dataset.artifacts].map((entity) => [entity.id, entity]),
  );
}

/**
 * Replays a WhatIf branch and builds the cumulative one-hop change view.
 * Removed entities are retained as tombstones so the renderer can grey them out.
 */
export function buildWhatIfGraphView(
  base: Dataset,
  turns: WhatIfTurnDetail[],
  options: WhatIfGraphViewOptions = {},
): WhatIfGraphView {
  let effective = base;
  const nodeChanges = new Map<string, WhatIfNodeChange>();
  const tombstones = new Map<string, GraphEntity>();
  const edgeChangeEndpointIds = new Set<string>();
  const addedEdgeIds = new Set<string>();

  for (const turn of turns) {
    const turnDiff = normalizeDiffAgainstDataset(effective, turn.diff, {
      premise: turn.premise,
      narrative: turn.narrative,
    });
    const before = entitiesById(effective);
    const relationsBefore = new Map(effective.relations.map((relation) => [relation.id, relation]));
    const removedIds = new Set(turnDiff.removedNodes);

    for (const relation of turnDiff.addedEdges) {
      addedEdgeIds.add(relation.id);
      edgeChangeEndpointIds.add(relation.source);
      edgeChangeEndpointIds.add(relation.target);
    }
    for (const relationId of turnDiff.removedEdges) {
      const relation = relationsBefore.get(relationId);
      if (!relation) continue;
      if (removedIds.has(relation.source) || removedIds.has(relation.target)
        || nodeChanges.get(relation.source) === "removed"
        || nodeChanges.get(relation.target) === "removed") continue;
      edgeChangeEndpointIds.add(relation.source);
      edgeChangeEndpointIds.add(relation.target);
    }

    for (const id of removedIds) {
      const entity = before.get(id);
      if (!entity) continue;
      tombstones.set(id, entity);
      nodeChanges.set(id, "removed");
    }

    for (const node of turnDiff.addedNodes) {
      if (before.has(node.id)) continue;
      tombstones.delete(node.id);
      nodeChanges.set(node.id, "added");
    }

    const modifiedIds = new Set([
      ...turnDiff.modifiedEvents.map((change) => change.characterId),
      ...turnDiff.replacedEvents.map((change) => change.characterId),
    ]);
    for (const id of modifiedIds) {
      if (!before.has(id) || removedIds.has(id)) continue;
      if (nodeChanges.get(id) !== "added") {
        nodeChanges.set(id, "modified");
      }
    }

    effective = applyDiff(effective, turnDiff);
  }

  const characters = [...effective.characters];
  const artifacts = [...effective.artifacts];
  const liveIds = new Set([...characters, ...artifacts].map((entity) => entity.id));

  for (const [id, entity] of tombstones) {
    if (liveIds.has(id) || nodeChanges.get(id) !== "removed") continue;
    if ("era_layer" in entity) characters.push(entity);
    else artifacts.push(entity);
    liveIds.add(id);
  }

  const changedIds = new Set(
    [...nodeChanges.keys()].filter((id) => liveIds.has(id)),
  );
  if (options.scope === "all") {
    return {
      dataset: {
        ...effective,
        characters,
        artifacts,
        relations: effective.relations.filter(
          (relation) => liveIds.has(relation.source) && liveIds.has(relation.target),
        ),
      },
      nodeChanges: new Map(
        [...nodeChanges].filter(([id]) => liveIds.has(id)),
      ),
    };
  }

  const visibleIds = new Set([
    ...changedIds,
    ...[...edgeChangeEndpointIds].filter((id) => liveIds.has(id)),
  ]);
  const relations = effective.relations.filter(
    (relation) =>
      liveIds.has(relation.source) &&
      liveIds.has(relation.target) &&
      (changedIds.has(relation.source)
        || changedIds.has(relation.target)
        || addedEdgeIds.has(relation.id)),
  );
  for (const relation of relations) {
    visibleIds.add(relation.source);
    visibleIds.add(relation.target);
  }

  return {
    dataset: {
      ...effective,
      characters: characters.filter((entity) => visibleIds.has(entity.id)),
      artifacts: artifacts.filter((entity) => visibleIds.has(entity.id)),
      relations,
    },
    nodeChanges: new Map(
      [...nodeChanges].filter(([id]) => visibleIds.has(id)),
    ),
  };
}
