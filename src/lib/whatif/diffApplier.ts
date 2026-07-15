/**
 * Diff 应用纯函数
 *
 * - applyDiff(base, diff) -> 新 Dataset（不 mutate base）
 * - replayBranch(base, turns) -> 重放 branch 内所有 turn 的 diff
 *
 * 设计原则：
 *   - 不可变：所有操作返回新对象，符合用户全局 CLAUDE.md 的 immutability 要求
 *   - 纯函数：无副作用，易于单元测试
 *   - 容错：diff 中引用了不存在的人物/关系时，跳过而不抛错（LLM 可能出错）
 */
import type {
  Artifact,
  Character,
  CharacterEvent,
  Citation,
  Dataset,
  Relation,
  RelationEvent,
} from "@/schemas/character";
import type { GraphDiff, WhatIfTurnDetail } from "@/schemas/whatif";

function unwrappedWork(work: string): string {
  let base = work.trim();
  while (base.startsWith("《") && base.endsWith("》")) {
    base = base.slice(1, -1).trim();
  }
  return base;
}

function adaptationWork(work: string): string {
  let base = work.trim();
  if (base.endsWith("-改编")) base = base.slice(0, -3).trim();
  base = unwrappedWork(base);
  return `${base}-改编`;
}

function primaryWork(dataset: Dataset): string | null {
  const counts = new Map<string, number>();
  const add = (source: Citation | null | undefined) => {
    if (!source?.work.trim()) return;
    const work = adaptationWork(source.work).slice(0, -3);
    counts.set(work, (counts.get(work) ?? 0) + 1);
  };

  for (const character of dataset.characters) {
    character.events.forEach((event) => add(event.source));
    character.quotes.forEach((quote) => add(quote.source));
  }
  for (const artifact of dataset.artifacts) artifact.events.forEach((event) => add(event.source));
  for (const relation of dataset.relations) relation.events.forEach((event) => add(event.source));

  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function adaptationSource(
  source: Citation | null | undefined,
  preferredWork: string | null,
): Citation | null {
  const work = preferredWork ?? source?.work ?? null;
  if (!work?.trim()) return null;
  return {
    work: adaptationWork(work),
    locus: source?.locus ?? null,
    translator: source?.translator ?? null,
  };
}

function canonicalSource(source: Citation | null | undefined): Citation | null {
  if (!source?.work.trim()) return null;
  return { ...source, work: unwrappedWork(source.work) };
}

function adaptCharacterEvent(event: CharacterEvent, preferredWork: string | null): CharacterEvent {
  return { ...event, source: adaptationSource(event.source, preferredWork) };
}

function adaptRelationEvent(event: RelationEvent, preferredWork: string | null): RelationEvent {
  return { ...event, source: adaptationSource(event.source, preferredWork) };
}

/**
 * 清理 LLM 把已有节点/关系再次放进 additions 的常见错误。
 * 返回新 diff，不修改模型原始输出或当前图谱。
 */
export function normalizeDiffAgainstDataset(base: Dataset, diff: GraphDiff): GraphDiff {
  const fallbackWork = primaryWork(base);
  const nodeIds = new Set([
    ...base.characters.map((character) => character.id),
    ...base.artifacts.map((artifact) => artifact.id),
  ]);
  const addedNodes = diff.addedNodes
    .filter((node) => {
      if (nodeIds.has(node.id)) return false;
      nodeIds.add(node.id);
      return true;
    })
    .map((node) => ({
      ...node,
      events: node.events.map((event) =>
        adaptCharacterEvent(event, event.source?.work ?? fallbackWork)),
    }));

  const relationIds = new Set(base.relations.map((relation) => relation.id));
  const addedEdges = diff.addedEdges
    .filter((relation) => {
      if (relationIds.has(relation.id)) return false;
      relationIds.add(relation.id);
      return true;
    })
    .map((relation) => ({
      ...relation,
      events: relation.events.map((event) =>
        adaptRelationEvent(event, event.source?.work ?? fallbackWork)),
    }));

  const characterById = new Map(base.characters.map((character) => [character.id, character]));
  const modifiedEvents = diff.modifiedEvents.map((change) => {
    const original = characterById.get(change.characterId)?.events[change.eventIndex];
    return {
      ...change,
      newEvent: adaptCharacterEvent(
        change.newEvent,
        original?.source?.work ?? change.newEvent.source?.work ?? fallbackWork,
      ),
    };
  });

  const replacedEvents = diff.replacedEvents.map((replacement) => {
    const originalEvents = characterById.get(replacement.characterId)?.events ?? [];
    const originalsByTitle = new Map(originalEvents.map((event) => [event.title, event]));
    return {
      ...replacement,
      newEvents: replacement.newEvents.map((event, index) => {
        const matchingOriginal = originalsByTitle.get(event.title);
        if (matchingOriginal) {
          return {
            ...event,
            source: canonicalSource(matchingOriginal.source ?? event.source),
          };
        }
        return adaptCharacterEvent(
          event,
          originalEvents[index]?.source?.work ?? event.source?.work ?? fallbackWork,
        );
      }),
    };
  });

  return { ...diff, addedNodes, addedEdges, modifiedEvents, replacedEvents };
}

/**
 * 把 diff 应用到 base dataset，返回新 Dataset。
 *
 * 步骤：
 *   1. 移除 removedNodes（按 id 过滤 characters + artifacts）
 *   2. 追加 addedNodes（仅 characters；artifact 暂不支持 LLM 新增）
 *   3. 移除 removedEdges（按 id 过滤 relations）
 *   4. 追加 addedEdges
 *   5. 应用 modifiedEvents（按 characterId + eventIndex 替换）
 */
export function applyDiff(base: Dataset, diff: GraphDiff): Dataset {
  diff = normalizeDiffAgainstDataset(base, diff);
  const removeNodeSet = new Set(diff.removedNodes);
  const removeEdgeSet = new Set(diff.removedEdges);

  // 1. 过滤 characters
  let characters: Character[] = base.characters.filter((c) => !removeNodeSet.has(c.id));

  // 2. 追加 addedNodes（只接受 Character，artifact 的新增不在 MVP 范围）
  if (diff.addedNodes.length > 0) {
    const existingIds = new Set(characters.map((c) => c.id));
    const newChars = diff.addedNodes.filter((c) => !existingIds.has(c.id));
    characters = [...characters, ...newChars];
  }

  // 3. 过滤 artifacts
  const artifacts: Artifact[] = base.artifacts.filter((a) => !removeNodeSet.has(a.id));

  // 4. 过滤 relations
  let relations: Relation[] = base.relations.filter((r) => !removeEdgeSet.has(r.id));

  // 5. 追加 addedEdges（去重，避免与现存 id 冲突）
  if (diff.addedEdges.length > 0) {
    const existingIds = new Set(relations.map((r) => r.id));
    const newRels = diff.addedEdges.filter((r) => !existingIds.has(r.id));
    relations = [...relations, ...newRels];
  }

  // 6. 应用 modifiedEvents
  if (diff.modifiedEvents.length > 0) {
    const modsByChar = new Map<string, typeof diff.modifiedEvents>();
    for (const m of diff.modifiedEvents) {
      const arr = modsByChar.get(m.characterId) ?? [];
      arr.push(m);
      modsByChar.set(m.characterId, arr);
    }

    characters = characters.map((c) => {
      const mods = modsByChar.get(c.id);
      if (!mods || mods.length === 0) return c;
      const newEvents = [...c.events];
      for (const m of mods) {
        if (m.eventIndex >= 0 && m.eventIndex < newEvents.length) {
          newEvents[m.eventIndex] = m.newEvent;
        } else if (m.eventIndex === newEvents.length) {
          // LLM 偶尔会把"追加"写成 next index
          newEvents.push(m.newEvent);
        }
      }
      return { ...c, events: newEvents };
    });
  }

  // 7. 应用 replacedEvents（替换某人物的全部 events）
  if (diff.replacedEvents && diff.replacedEvents.length > 0) {
    const replaceMap = new Map<string, typeof diff.replacedEvents[number]["newEvents"]>();
    for (const r of diff.replacedEvents) {
      replaceMap.set(r.characterId, r.newEvents);
    }
    characters = characters.map((c) => {
      const newEvents = replaceMap.get(c.id);
      return newEvents ? { ...c, events: newEvents } : c;
    });
  }

  return {
    ...base,
    characters,
    artifacts,
    relations,
  };
}

/**
 * 重放 branch 内所有 turn 的 diff，得到最终有效 dataset。
 *
 * turns 按 order 升序排列后依次 applyDiff。
 * 空数组返回 base（不复制，因为是 immutable）。
 */
export function replayBranch(base: Dataset, turns: WhatIfTurnDetail[]): Dataset {
  if (turns.length === 0) return base;
  const sorted = [...turns].sort((a, b) => a.order - b.order);
  return sorted.reduce<Dataset>((acc, turn) => applyDiff(acc, turn.diff), base);
}
