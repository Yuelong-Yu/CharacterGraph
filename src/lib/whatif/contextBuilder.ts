/**
 * 上下文压缩：从完整 Dataset 中提取分支点周围的子图，控制 LLM 输入 token。
 *
 * 算法：
 *   - core: 分支点人物完整信息（bio + events + quotes + epithet + category + era_layer）
 *   - 1度邻居: name + category + epithet + 与 core 的 relation（含 events）
 *   - 2度邻居: name + category（不含 relation 细节）
 *   - 相关 artifacts: core 和 1度邻居关联的宝物（name + epithet + category）
 *   - 原典节点上限 MAX_NODES=15，超限时依次裁剪 2 度、宝物、1 度节点
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

export const MAX_NODES = 15;

/**
 * 构建图谱子集。coreCharacterId 不存在时抛错。
 * branchCharacterIds 表示当前分支历史中由 addedNodes 新增且仍存在的人物；
 * 它们会完整输入且不占用不可变原典的节点预算。
 */
export function buildContext(
  dataset: Dataset,
  coreCharacterId: string,
  options: { branchCharacterIds?: ReadonlySet<string> } = {},
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

  // 裁剪：core 永远保留；原典节点超限时依次裁 2度、宝物、最后才裁 1度邻居。
  // 分支新增人物不会被裁剪，也不占用 MAX_NODES 预算。
  // 每类按 id 保留前面的项，避免 relation 文件顺序变化导致 prompt 前缀变化。
  const budgetedCount = <T extends { id: string }>(items: Iterable<T>) => (
    Array.from(items).filter((item) => !branchCharacterIds.has(item.id)).length
  );
  const totalNodes = 1
    + budgetedCount(neighborMap.values())
    + budgetedCount(secondDegreeMap.values())
    + artifacts.length;
  if (totalNodes > MAX_NODES) {
    let overflow = totalNodes - MAX_NODES;
    const trimMap = <T extends { id: string }>(map: Map<string, T>) => {
      const removableNodes = Array.from(map.values())
        .filter((item) => !branchCharacterIds.has(item.id))
        .sort((left, right) => left.id.localeCompare(right.id));
      const removable = Math.min(overflow, removableNodes.length);
      if (removable === 0) return;
      const removedIds = new Set(removableNodes.slice(-removable).map((item) => item.id));
      const retained = Array.from(map.values())
        .filter((item) => !removedIds.has(item.id))
        .sort((left, right) => left.id.localeCompare(right.id));
      map.clear();
      for (const item of retained) map.set(item.id, item);
      overflow -= removable;
    };

    trimMap(secondDegreeMap);

    const removableArtifacts = Math.min(overflow, artifacts.length);
    if (removableArtifacts > 0) {
      artifacts.sort((left, right) => left.id.localeCompare(right.id));
      artifacts.splice(artifacts.length - removableArtifacts, removableArtifacts);
      overflow -= removableArtifacts;
    }

    // 一度邻居也必须服从硬上限；此前这里没有裁剪，MAX_NODES 实际会失效。
    trimMap(neighborMap);
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
