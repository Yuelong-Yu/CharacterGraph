/**
 * 上下文压缩：从完整 Dataset 中提取分支点周围的子图，控制 LLM 输入 token。
 *
 * 算法：
 *   - core: 分支点人物完整信息（bio + events + quotes + epithet + category + era_layer）
 *   - 1度邻居: name + category + epithet + 与 core 的 relation（含 events）
 *   - 2度邻居: name + category（不含 relation 细节）
 *   - 相关 artifacts: core 和 1度邻居关联的宝物（name + epithet + category）
 *   - 上限 MAX_NODES=30，超限按 degree 排序裁剪
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

export interface GraphSubset {
  core: Pick<
    Character,
    "id" | "name_zh" | "name_en" | "aliases" | "epithet" | "category" | "era_layer" | "bio" | "events" | "quotes"
  >;
  neighbors: NeighborNode[];
  secondDegree: SecondDegreeNode[];
  artifacts: RelatedArtifact[];
}

const MAX_NODES = 30;

/**
 * 构建图谱子集。coreCharacterId 不存在时抛错。
 */
export function buildContext(dataset: Dataset, coreCharacterId: string): GraphSubset {
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

  // 裁剪：超过 MAX_NODES 时按优先级保留（core + 1度邻居 > 2度邻居 > artifacts）
  const totalNodes = 1 + neighborMap.size + secondDegreeMap.size + artifacts.length;
  if (totalNodes > MAX_NODES) {
    const overflow = totalNodes - MAX_NODES;
    // 优先裁 2度邻居，再裁 artifacts
    const secondDegreeArr = Array.from(secondDegreeMap.values());
    if (secondDegreeArr.length > overflow) {
      // 裁掉 overflow 个 2度邻居（按 id 字典序，确定性）
      const toRemove = secondDegreeArr
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, overflow);
      for (const r of toRemove) secondDegreeMap.delete(r.id);
    } else {
      // 全删 2度邻居，再裁 artifacts
      secondDegreeMap.clear();
      const artOverflow = overflow - secondDegreeArr.length;
      if (artOverflow > 0) {
        artifacts.splice(0, artOverflow);
      }
    }
  }

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
  };
}

/**
 * 把子集序列化为 prompt 用的紧凑 JSON 字符串。
 * 故意保留中文键值，让 LLM 直接读人物中文名。
 */
export function formatSubsetForPrompt(subset: GraphSubset): string {
  return JSON.stringify(subset, null, 2);
}
