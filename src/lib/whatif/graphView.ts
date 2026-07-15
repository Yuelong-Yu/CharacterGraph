import type { Artifact, Character, Dataset } from "@/schemas/character";
import type { WhatIfTurnDetail } from "@/schemas/whatif";
import { applyDiff } from "./diffApplier";

export type WhatIfNodeChange = "added" | "modified" | "removed";

export interface WhatIfGraphView {
  dataset: Dataset;
  nodeChanges: Map<string, WhatIfNodeChange>;
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
): WhatIfGraphView {
  let effective = base;
  const nodeChanges = new Map<string, WhatIfNodeChange>();
  const tombstones = new Map<string, GraphEntity>();

  for (const turn of turns) {
    const before = entitiesById(effective);
    const removedIds = new Set(turn.diff.removedNodes);

    for (const id of removedIds) {
      const entity = before.get(id);
      if (!entity) continue;
      tombstones.set(id, entity);
      nodeChanges.set(id, "removed");
    }

    for (const node of turn.diff.addedNodes) {
      if (before.has(node.id)) continue;
      tombstones.delete(node.id);
      nodeChanges.set(node.id, "added");
    }

    const modifiedIds = new Set([
      ...turn.diff.modifiedEvents.map((change) => change.characterId),
      ...turn.diff.replacedEvents.map((change) => change.characterId),
    ]);
    for (const id of modifiedIds) {
      if (!before.has(id) || removedIds.has(id)) continue;
      if (nodeChanges.get(id) !== "added") {
        nodeChanges.set(id, "modified");
      }
    }

    effective = applyDiff(effective, turn.diff);
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
  const relations = effective.relations.filter(
    (relation) =>
      liveIds.has(relation.source) &&
      liveIds.has(relation.target) &&
      (changedIds.has(relation.source) || changedIds.has(relation.target)),
  );
  const visibleIds = new Set(changedIds);
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
