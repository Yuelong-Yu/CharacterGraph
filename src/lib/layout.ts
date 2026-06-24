/**
 * 用 dagre 把 Character + Relation 排版成 React Flow 节点和边坐标。
 *
 * - 节点按 era_layer 分代际（垂直方向分层）
 * - 边默认只取 primary_type === "blood" 用于布局（族谱为骨）
 *   其他关系类型作为视觉叠加，不参与 dagre 布局，避免毛线团
 *
 * 输入：Character[], Relation[]
 * 输出：{ nodes: RFNode[], edges: RFEdge[] }
 */
import dagre from "@dagrejs/dagre";
import type { Character, Relation } from "@/schemas/character";

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  data: Character;
}

export interface PositionedEdge {
  id: string;
  source: string;
  target: string;
  data: Relation;
}

const NODE_W = 180;
const NODE_H = 110;

export function layoutGraph(
  characters: Character[],
  relations: Relation[],
): { nodes: PositionedNode[]; edges: PositionedEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 60,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // ── 节点 ──
  // dagre 自身按图拓扑计算层级，但我们想强制按 era_layer 分代际。
  // 做法：把 era_layer 作为 rank 提示——同 era_layer 的节点放在同 rank。
  for (const c of characters) {
    g.setNode(c.id, { width: NODE_W, height: NODE_H, rank: c.era_layer });
  }

  // ── 仅血缘边参与布局 ──
  for (const r of relations) {
    if (r.primary_type !== "blood") continue;
    if (!g.hasNode(r.source) || !g.hasNode(r.target)) continue;
    g.setEdge(r.source, r.target);
  }

  dagre.layout(g);

  const charIndex = new Map(characters.map((c) => [c.id, c]));
  const nodes: PositionedNode[] = characters.map((c) => {
    const n = g.node(c.id);
    return {
      id: c.id,
      x: n.x - NODE_W / 2,
      y: n.y - NODE_H / 2,
      data: c,
    };
  });

  const edges: PositionedEdge[] = relations
    .filter((r) => charIndex.has(r.source) && charIndex.has(r.target))
    .map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      data: r,
    }));

  return { nodes, edges };
}
