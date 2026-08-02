/**
 * 上下文压缩：从完整 Dataset 中提取分支点周围的子图，控制 LLM 输入 token。
 *
 * 算法：
 *   - core: 分支点人物完整信息（bio + events + quotes + epithet + category + era_layer）
 *   - 1度邻居: name + category + epithet + 与 core 的 relation（含 events）
 *   - 2度邻居: name + category（不含 relation 细节）
 *   - 相关 artifacts: core 和 1度邻居关联的宝物（name + epithet + category）
 *   - 首轮原典节点上限 INITIAL_MAX_NODES=7；每完成 5 轮续写增加 1，最高 MAX_NODES=15
 *   - 节点按分支事件和正在修改人物的关联度排序，保证小上下文优先保留最相关人物
 *   - 当前推演分支新增的人物完整保留，不计入原典节点上限
 *
 * 预估压缩后 3-5k token（vs 全量 50k）。
 */
import type { Dataset, Character, Relation, Artifact } from "@/schemas/character";

export interface NeighborNode {
  id: string;
  name_zh: string;
  name_en: string;
  category: string;
  epithet: string | null;
  era_layer: number;
  relation: Pick<Relation, "id" | "primary_type" | "composite_types" | "events">;
}

export interface SecondDegreeNode {
  id: string;
  name_zh: string;
  category: string;
  epithet: string | null;
  era_layer: number;
}

export interface RelatedArtifact {
  id: string;
  name_zh: string;
  category: string;
  epithet: string | null;
  relation: Pick<Relation, "id" | "primary_type">;
}

export type BranchAddedCharacter = Pick<
  Character,
  "id" | "name_zh" | "name_en" | "aliases" | "epithet" | "category" | "era_layer" | "bio" | "events" | "quotes"
>;

export type BranchAddedRelation = Pick<
  Relation,
  "id" | "source" | "target" | "primary_type" | "composite_types" | "events"
>;

export interface GraphSubset {
  core: Pick<
    Character,
    "id" | "name_zh" | "name_en" | "aliases" | "epithet" | "category" | "era_layer" | "bio" | "events" | "quotes"
  >;
  neighbors: NeighborNode[];
  secondDegree: SecondDegreeNode[];
  artifacts: RelatedArtifact[];
  /** 当前推演分支由 diff.addedNodes 新增的人物；不受 MAX_NODES 限制。 */
  branchAddedCharacters: BranchAddedCharacter[];
  /** 与分支新增人物相连的关系，随完整人物信息一并输入。 */
  branchAddedRelations: BranchAddedRelation[];
}

/** 首轮推演的原典节点预算（包含 core 和 artifacts）。 */
export const INITIAL_MAX_NODES = 7;
/** 原典节点预算的硬上限。 */
export const MAX_NODES = 15;
const CONTINUATIONS_PER_NODE_INCREASE = 5;

/**
 * 根据已完成的续写轮数计算下一轮所用的原典节点预算。
 * 例如完成 5 轮续写后，第 6 轮续写使用 8 个节点。
 */
export function maxNodesForCompletedContinuations(completedContinuations: number): number {
  const completed = Number.isFinite(completedContinuations)
    ? Math.max(0, Math.floor(completedContinuations))
    : 0;
  return Math.min(
    MAX_NODES,
    INITIAL_MAX_NODES + Math.floor(completed / CONTINUATIONS_PER_NODE_INCREASE),
  );
}

export interface BuildContextOptions {
  /** 当前推演分支由 diff.addedNodes 新增且仍存在的人物；不计入原典节点预算。 */
  branchCharacterIds?: ReadonlySet<string>;
  /** 本轮的原典节点预算；未提供时保留历史兼容的 15 节点行为。 */
  maxNodes?: number;
  /** 与本轮前提、用户续写或历史事件最相关的文本。 */
  relevanceText?: string;
  /** 需要优先保留的人物，例如本轮历史中被改写的人物。 */
  priorityCharacterIds?: ReadonlySet<string>;
}

function relevanceTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) terms.add(word);
  for (const sequence of text.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (sequence.length === 1) {
      terms.add(sequence);
      continue;
    }
    for (let index = 0; index < sequence.length - 1; index += 1) {
      terms.add(sequence.slice(index, index + 2));
    }
  }
  return terms;
}

function overlapScore(queryTerms: ReadonlySet<string>, text: string): number {
  if (queryTerms.size === 0) return 0;
  let score = 0;
  for (const term of relevanceTerms(text)) {
    if (queryTerms.has(term)) score += 1;
  }
  return score;
}

function characterText(character: Character): string {
  return [
    character.name_zh,
    character.name_en,
    ...character.aliases,
    character.epithet ?? "",
    character.bio ?? "",
    ...character.events.flatMap((event) => [event.title, event.desc]),
  ].join(" ");
}

function relationText(relation: Relation): string {
  return relation.events.flatMap((event) => [event.title, event.desc, event.desc_long ?? ""]).join(" ");
}

/**
 * 构建图谱子集。coreCharacterId 不存在时抛错。
 * branchCharacterIds 表示当前分支历史中由 addedNodes 新增且仍存在的人物；
 * 它们会完整输入且不占用不可变原典的节点预算。
 */
export function buildContext(
  dataset: Dataset,
  coreCharacterId: string,
  options: BuildContextOptions = {},
): GraphSubset {
  const core = dataset.characters.find((c) => c.id === coreCharacterId);
  if (!core) {
    throw new Error(`buildContext: character not found: ${coreCharacterId}`);
  }

  // 1度邻居：所有与 core 相连的 relation 的另一端
  const coreRelations = dataset.relations.filter(
    (r) => r.source === coreCharacterId || r.target === coreCharacterId,
  );

  const neighborMap = new Map<string, NeighborNode>();
  const neighborIds = new Set<string>();
  for (const rel of coreRelations) {
    const otherId = rel.source === coreCharacterId ? rel.target : rel.source;
    if (otherId === coreCharacterId) continue;
    // 跳过 self-loop
    const character = dataset.characters.find((c) => c.id === otherId);
    if (!character) continue; // 另一端可能是 artifact，下面单独处理
    if (neighborMap.has(otherId)) continue;
    neighborMap.set(otherId, {
      id: character.id,
      name_zh: character.name_zh,
      name_en: character.name_en,
      category: character.category,
      epithet: character.epithet,
      era_layer: character.era_layer,
      relation: {
        id: rel.id,
        primary_type: rel.primary_type,
        composite_types: rel.composite_types,
        events: rel.events,
      },
    });
    neighborIds.add(otherId);
  }

  // 2度邻居：1度邻居的邻居（排除 core 和已收录的1度邻居）
  const secondDegreeMap = new Map<string, SecondDegreeNode>();
  for (const neighborId of neighborIds) {
    const twoHopRels = dataset.relations.filter(
      (r) =>
        (r.source === neighborId || r.target === neighborId) &&
        r.source !== coreCharacterId &&
        r.target !== coreCharacterId,
    );
    for (const rel of twoHopRels) {
      const otherId = rel.source === neighborId ? rel.target : rel.source;
      if (otherId === coreCharacterId || neighborIds.has(otherId)) continue;
      const character = dataset.characters.find((c) => c.id === otherId);
      if (!character) continue;
      if (secondDegreeMap.has(otherId)) continue;
      secondDegreeMap.set(otherId, {
        id: character.id,
        name_zh: character.name_zh,
        category: character.category,
        epithet: character.epithet,
        era_layer: character.era_layer,
      });
    }
  }

  // 当前推演中已被改写的人物，以及与这些人物直接相连的人物，优先进入候选集。
  // 这些人物有时不在 branch point 的两度范围内，因此额外补入 secondDegree 容器；
  // 它们仍以精简信息发送，完整的分支新增人物则走下方的独立字段。
  const priorityCharacterIds = options.priorityCharacterIds ?? new Set<string>();
  const directPriorityNeighborIds = new Set<string>();
  const addSecondDegreeCandidate = (characterId: string) => {
    if (characterId === coreCharacterId || neighborIds.has(characterId) || secondDegreeMap.has(characterId)) return;
    const character = dataset.characters.find((item) => item.id === characterId);
    if (!character) return;
    secondDegreeMap.set(characterId, {
      id: character.id,
      name_zh: character.name_zh,
      category: character.category,
      epithet: character.epithet,
      era_layer: character.era_layer,
    });
  };
  for (const priorityId of priorityCharacterIds) {
    addSecondDegreeCandidate(priorityId);
    for (const relation of dataset.relations) {
      if (relation.source !== priorityId && relation.target !== priorityId) continue;
      const otherId = relation.source === priorityId ? relation.target : relation.source;
      directPriorityNeighborIds.add(otherId);
      addSecondDegreeCandidate(otherId);
    }
  }

  // 相关 artifacts：core 关联的宝物（OWNS 类型 relation 的 target 通常是 artifact）
  const artifacts: RelatedArtifact[] = [];
  for (const rel of coreRelations) {
    const otherId = rel.source === coreCharacterId ? rel.target : rel.source;
    const artifact = dataset.artifacts.find((a) => a.id === otherId);
    if (artifact && !artifacts.find((a) => a.id === artifact.id)) {
      artifacts.push({
        id: artifact.id,
        name_zh: artifact.name_zh,
        category: artifact.category,
        epithet: artifact.epithet,
        relation: { id: rel.id, primary_type: rel.primary_type },
      });
    }
  }

  const branchCharacterIds = options.branchCharacterIds ?? new Set<string>();
  const requestedNodeBudget = options.maxNodes ?? MAX_NODES;
  const nodeBudget = Number.isFinite(requestedNodeBudget)
    ? Math.min(MAX_NODES, Math.max(1, Math.floor(requestedNodeBudget)))
    : MAX_NODES;

  // 裁剪：core 永远保留；分支新增人物不会被裁剪，也不占用节点预算。
  // 其他候选先按事件/人物关联度排序，分数相同时才沿用 1 度人物、宝物、2 度人物的优先级。
  const budgetedCount = <T extends { id: string }>(items: Iterable<T>) => (
    Array.from(items).filter((item) => !branchCharacterIds.has(item.id)).length
  );
  const totalNodes = 1
    + budgetedCount(neighborMap.values())
    + budgetedCount(secondDegreeMap.values())
    + artifacts.length;
  if (totalNodes > nodeBudget) {
    const queryText = [
      options.relevanceText ?? "",
      ...core.events
        .filter((event) => (options.relevanceText ?? "").includes(event.title))
        .flatMap((event) => [event.title, event.desc]),
    ].join(" ");
    const queryTerms = relevanceTerms(queryText);
    const charactersById = new Map(dataset.characters.map((character) => [character.id, character]));
    const relationsByCharacterId = new Map<string, Relation[]>();
    for (const relation of dataset.relations) {
      for (const characterId of [relation.source, relation.target]) {
        const relations = relationsByCharacterId.get(characterId) ?? [];
        relations.push(relation);
        relationsByCharacterId.set(characterId, relations);
      }
    }
    type Candidate = { id: string; tier: number };
    const candidates: Candidate[] = [
      ...Array.from(neighborMap.values(), (node) => ({ id: node.id, tier: 3 })),
      ...artifacts.map((artifact) => ({ id: artifact.id, tier: 2 })),
      ...Array.from(secondDegreeMap.values(), (node) => ({ id: node.id, tier: 1 })),
    ].filter((candidate) => !branchCharacterIds.has(candidate.id));
    const score = (candidate: Candidate) => {
      const character = charactersById.get(candidate.id);
      const eventScore = overlapScore(queryTerms, [
        character ? characterText(character) : "",
        ...(relationsByCharacterId.get(candidate.id) ?? []).map(relationText),
      ].join(" "));
      return (priorityCharacterIds.has(candidate.id) ? 10_000 : 0)
        + (directPriorityNeighborIds.has(candidate.id) ? 5_000 : 0)
        + eventScore * 100;
    };
    const retainedIds = new Set(
      candidates
        .sort((left, right) => (
          score(right) - score(left)
          || right.tier - left.tier
          || left.id.localeCompare(right.id)
        ))
        .slice(0, Math.max(0, nodeBudget - 1))
        .map((candidate) => candidate.id),
    );
    const retainMap = <T extends { id: string }>(map: Map<string, T>) => {
      for (const id of Array.from(map.keys())) {
        if (!branchCharacterIds.has(id) && !retainedIds.has(id)) map.delete(id);
      }
    };
    retainMap(neighborMap);
    retainMap(secondDegreeMap);
    for (let index = artifacts.length - 1; index >= 0; index -= 1) {
      if (!retainedIds.has(artifacts[index].id)) artifacts.splice(index, 1);
    }
  }

  const branchAddedCharacters = dataset.characters
    .filter((character) => branchCharacterIds.has(character.id))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((character) => ({
      id: character.id,
      name_zh: character.name_zh,
      name_en: character.name_en,
      aliases: character.aliases,
      epithet: character.epithet,
      category: character.category,
      era_layer: character.era_layer,
      bio: character.bio,
      events: character.events,
      quotes: character.quotes,
    }));
  const branchAddedRelations = dataset.relations
    .filter((relation) => (
      branchCharacterIds.has(relation.source) || branchCharacterIds.has(relation.target)
    ))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      primary_type: relation.primary_type,
      composite_types: relation.composite_types,
      events: relation.events,
    }));

  return {
    core: {
      id: core.id,
      name_zh: core.name_zh,
      name_en: core.name_en,
      aliases: core.aliases,
      epithet: core.epithet,
      category: core.category,
      era_layer: core.era_layer,
      bio: core.bio,
      events: core.events,
      quotes: core.quotes,
    },
    neighbors: Array.from(neighborMap.values()),
    secondDegree: Array.from(secondDegreeMap.values()),
    artifacts,
    branchAddedCharacters,
    branchAddedRelations,
  };
}

/**
 * 把子集序列化为 prompt 用的紧凑 JSON 字符串。
 * 故意保留中文键值，让 LLM 直接读人物中文名。
 */
export function formatSubsetForPrompt(subset: GraphSubset): string {
  return JSON.stringify(subset, null, 2);
}
