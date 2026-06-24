"use client";

/**
 * 主图谱组件 — 双栏布局的左侧（React Flow）
 *
 * 接收 server 加载好的 dataset，调 layoutGraph 排版，渲染节点和边。
 * 点击节点/边 → 通过 props 回调通知外层切换右侧面板。
 *
 * 边样式：
 *  - color = primary_type 对应颜色
 *  - 粗细 = events 数量（1-5px）
 */
import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type NodeTypes,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { Dataset } from "@/schemas/character";
import { CharacterNode, type CharNode } from "./CharacterNode";
import { layoutGraph } from "@/lib/layout";
import { COLOR, RELATION_COLOR } from "@/lib/tokens";

const nodeTypes: NodeTypes = { character: CharacterNode as NodeTypes[string] };

interface Props {
  dataset: Dataset;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  /** 外部要求把某节点居中（如搜索命中） */
  focusNodeId?: string | null;
  onNodeSelect?: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  onBackgroundClick?: () => void;
}

function GraphInner({
  dataset,
  selectedNodeId,
  selectedEdgeId,
  focusNodeId,
  onNodeSelect,
  onEdgeSelect,
  onBackgroundClick,
}: Props) {
  const rf = useReactFlow();
  const lastFocus = useRef<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const { nodes: pn, edges: pe } = layoutGraph(dataset.characters, dataset.relations);

    const rfNodes: CharNode[] = pn.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      data: n.data,
      type: "character" as const,
      selected: n.id === selectedNodeId,
    }));

    const rfEdges: Edge[] = pe.map((e) => {
      const color = RELATION_COLOR[e.data.primary_type];
      const width = Math.min(5, Math.max(1, e.data.events.length || 1));
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        style: { stroke: color, strokeWidth: width, opacity: 0.85 },
        animated: e.id === selectedEdgeId,
        selected: e.id === selectedEdgeId,
        markerEnd: e.data.primary_type === "blood"
          ? { type: MarkerType.ArrowClosed, color, width: 14, height: 14 }
          : undefined,
        data: e.data,
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [dataset, selectedNodeId, selectedEdgeId]);

  // 外部要求 focus 到某节点
  useEffect(() => {
    if (!focusNodeId || focusNodeId === lastFocus.current) return;
    const n = nodes.find((x) => x.id === focusNodeId);
    if (n) {
      rf.setCenter(n.position.x + 90, n.position.y + 55, { zoom: 1.1, duration: 600 });
      lastFocus.current = focusNodeId;
    }
  }, [focusNodeId, nodes, rf]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => onNodeSelect?.(node.id),
    [onNodeSelect],
  );

  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_evt, edge) => onEdgeSelect?.(edge.id),
    [onEdgeSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onEdgeClick={handleEdgeClick}
      onPaneClick={onBackgroundClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.25}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color={COLOR.border} gap={28} size={1} />
      <Controls
        showInteractive={false}
        style={{
          background: COLOR.bgPanel,
          border: `1px solid ${COLOR.border}`,
          borderRadius: 6,
        }}
      />
    </ReactFlow>
  );
}

export function Graph(props: Props) {
  return (
    <div style={{ width: "100%", height: "100%", background: COLOR.bg, position: "relative" }}>
      <ReactFlowProvider>
        <GraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
