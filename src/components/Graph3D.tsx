"use client";

/**
 * 3D 图谱 — react-force-graph-3d
 *
 * 普通模式（focusedId === null）：
 *   - 全部 18 节点 + 62 边按 layoutMode（tier / free）渲染
 *
 * 聚焦模式（focusedId !== null）：
 *   - 聚焦节点固定在原点
 *   - 邻居（直接相连）在 XY 平面圆形排列
 *   - 非邻居节点 + 非聚焦边全部 nodeVisibility/linkVisibility=false 隐藏
 *   - 与聚焦节点相关的边视觉加粗高亮
 *
 * 决策来源：用户后续聚焦/圆形布局/隐藏非邻居 决定
 */

import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import SpriteText from "three-spritetext";

import type { Artifact, Dataset, Character, Relation } from "@/schemas/character";
import type { WhatIfNodeChange } from "@/lib/whatif/graphView";
import { COLOR, FONT } from "@/lib/tokens";
import { useProjectConfig } from "@/lib/projectConfig";

// SSR off — three.js 只能在浏览器
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

// ─── 纹理缓存 ───────────────────────────────────────────
const _texCache = new Map<string, THREE.Texture>();
const _texLoader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;
const _preloadedImages = new Set<string>();

function getThumbTexture(url: string): THREE.Texture | null {
  if (!_texLoader || !url) return null;
  const hit = _texCache.get(url);
  if (hit) return hit;
  const tex = _texLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(url, tex);
  return tex;
}

function preloadImageUrls(urls: string[]) {
  if (typeof document === "undefined") return;
  for (const url of urls) {
    if (_preloadedImages.has(url)) continue;
    _preloadedImages.add(url);

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    document.head.appendChild(link);

    const img = new Image();
    img.decoding = "async";
    img.fetchPriority = "high";
    img.src = url;
  }
}

let _haloTex: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (_haloTex) return _haloTex;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _haloTex = new THREE.CanvasTexture(canvas);
  return _haloTex;
}

let _shadowTex: THREE.Texture | null = null;
function getShadowTexture(): THREE.Texture {
  if (_shadowTex) return _shadowTex;
  const w = 128, h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.6, "rgba(0,0,0,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  _shadowTex = new THREE.CanvasTexture(canvas);
  return _shadowTex;
}

// 文字标签纹理 — 把中文文字绘到 canvas 上，让 mesh 走 opaque 队列
const _labelTexCache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();
const _screenUpVec = new THREE.Vector3();
const _screenDepthVec = new THREE.Vector3();
const _screenOffsetVec = new THREE.Vector3();

function setCameraPlaneTransform(
  object: THREE.Object3D,
  camera: THREE.Camera,
  offsetY: number,
  offsetZ = 0,
) {
  _screenUpVec.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(offsetY);
  _screenDepthVec.set(0, 0, 1).applyQuaternion(camera.quaternion).multiplyScalar(offsetZ);
  object.position.copy(_screenOffsetVec.copy(_screenUpVec).add(_screenDepthVec));
  object.quaternion.copy(camera.quaternion);
}

function getLabelTexture(
  text: string,
  textColor: string,
  bgColor: string,
  fontFace: string,
  fontWeight: string,
  fontPx: number,
): { texture: THREE.CanvasTexture; aspect: number } {
  const key = `${text}|${textColor}|${bgColor}|${fontFace}|${fontWeight}|${fontPx}`;
  const hit = _labelTexCache.get(key);
  if (hit) return hit;

  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d")!;
  mctx.font = `${fontWeight} ${fontPx}px ${fontFace}`;
  const measured = mctx.measureText(text);
  const padX = Math.round(fontPx * 0.35);
  const padY = Math.round(fontPx * 0.2);
  const w = Math.ceil(measured.width) + padX * 2;
  const h = fontPx + padY * 2;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontWeight} ${fontPx}px ${fontFace}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const radius = Math.round(fontPx * 0.18);
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.quadraticCurveTo(w, 0, w, radius);
  ctx.lineTo(w, h - radius);
  ctx.quadraticCurveTo(w, h, w - radius, h);
  ctx.lineTo(radius, h);
  ctx.quadraticCurveTo(0, h, 0, h - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, w / 2, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const result = { texture: tex, aspect: w / h };
  _labelTexCache.set(key, result);
  return result;
}

// ─── 类型 ───────────────────────────────────────────────
export type LayoutMode = "tier" | "free";

interface CharacterGraphNode {
  id: string;
  kind: "character";
  entity: Character;
  // 力学引擎用字段（运行时由 d3-force 写入 / 我们覆盖）
  x?: number; y?: number; z?: number;
  fx?: number; fy?: number; fz?: number;
}

interface ArtifactGraphNode {
  id: string;
  kind: "artifact";
  entity: Artifact;
  /** tier 布局用:Artifact 取主人 era_layer(多主人取第一个),无主人则 2 */
  eraLayer: number;
  x?: number; y?: number; z?: number;
  fx?: number; fy?: number; fz?: number;
}

type GraphNode = CharacterGraphNode | ArtifactGraphNode;
type NodeVisualMode = "normal" | "selected" | "highlighted";

interface NodeVisualEntry {
  outer: THREE.Group;
  activeMode: NodeVisualMode;
  variants: Map<NodeVisualMode, THREE.Group>;
}

function disposeNodeVisual(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of materials) material.dispose();
  });
}

interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  rel: Relation;
}

interface Props {
  dataset: Dataset;
  /** WhatIf 累计变更状态，用于绘制新增、修改和删除样式。 */
  whatIfNodeChanges?: ReadonlyMap<string, WhatIfNodeChange> | null;
  /** 专注展示变更视图时忽略主图筛选条件。 */
  bypassFilters?: boolean;
  layoutMode: LayoutMode;
  /** 选中态（右侧人物面板）— 与 focusedId 解耦 */
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  /** 聚焦态（中心化+圆环布局） */
  focusedId?: string | null;
  focusNodeId?: string | null;
  /** 当前启用的类别集合 — 不在此集合的节点和相关边将被隐藏（聚焦模式下豁免） */
  enabledCategories: Set<string>;
  /** 当前启用的 Artifact 类别集合 */
  enabledArtifactCategories: Set<string>;
  /** 度数阈值 — 过滤掉度数 < 阈值的节点（聚焦模式下豁免）。0 = 不过滤 */
  minDegree: number;
  /** 搜索命中集 — null 表示无过滤;非 null 时进入"过滤平铺"态:
   *  - 仅命中集节点可见,仅两端都命中的边可见
   *  - 按命中集的连通分量做"中心+圆环"子图,多个分量 bin-pack
   *  - 度为 0 的孤点单独排一个底部环
   *  - 镜头锁俰视(z+ 朝下),zoomToFit 命中节点,巡游暂停
   *  - 聚焦模式下豁免 */
  matchedIds: Set<string> | null;
  /** 自动旋转 + 轮播巡游 */
  autoTour: boolean;
  onNodeSelect?: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  onBackgroundClick?: () => void;
}

const LAYER_SPACING = 80;
// 邻居圆环半径基数
const FOCUS_RADIUS_BASE = 55;
const FOCUS_RADIUS_PER_NEIGHBOR = 2.5;
const NORMAL_FIT_PADDING = 110;
const NORMAL_CHARGE_STRENGTH = -95;
const NORMAL_LINK_DISTANCE = 82;
const ARTIFACT_LINK_DISTANCE = 62;

function tierYForNode(node: GraphNode): number {
  return (3 - (node.kind === "character" ? node.entity.era_layer : node.eraLayer)) * LAYER_SPACING;
}

function nodeCoord(n: GraphNode): { x: number; y: number; z: number } {
  return {
    x: n.x ?? n.fx ?? 0,
    y: n.y ?? n.fy ?? 0,
    z: n.z ?? n.fz ?? 0,
  };
}

export function Graph3D({
  dataset,
  whatIfNodeChanges = null,
  bypassFilters = false,
  layoutMode,
  selectedNodeId,
  selectedEdgeId,
  focusedId = null,
  focusNodeId,
  enabledCategories,
  enabledArtifactCategories,
  minDegree,
  matchedIds,
  autoTour,
  onNodeSelect,
  onEdgeSelect,
  onBackgroundClick,
}: Props) {
  const { config, characterCategoryColor, artifactCategoryColor, relationColor } = useProjectConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [graphReady, setGraphReady] = useState(false);
  const [initialFitReady, setInitialFitReady] = useState(false);

  // 容器尺寸观察
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (graphReady) return;
    let raf = 0;
    const check = () => {
      if (fgRef.current) {
        setGraphReady(true);
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);
    return () => cancelAnimationFrame(raf);
  }, [graphReady, size.w, size.h]);

  // 启动后强制把镜头拉远到能看到所有节点（占位 — fitCameraToAllNodes 定义在 nodes 之后）
  const didInitialFitRef = useRef(false);
  void didInitialFitRef; // 保留 ref 占位但不再使用

  // ── Artifact tier layer:以第一个「人物→神器」关系的主人 era_layer 定位;无主人则 2 ──
  const artifactEraMap = useMemo(() => {
    const charById = new Map(dataset.characters.map((c) => [c.id, c]));
    const m = new Map<string, number>();
    for (const a of dataset.artifacts) m.set(a.id, 2);
    for (const r of dataset.relations) {
      const owner = charById.get(r.source);
      if (owner && m.has(r.target)) m.set(r.target, owner.era_layer);
    }
    return m;
  }, [dataset.characters, dataset.artifacts, dataset.relations]);

  // ── 度数表：每个节点的入度+出度（基于全数据集，不受类别过滤影响） ──
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of dataset.characters) m.set(c.id, 0);
    for (const a of dataset.artifacts) m.set(a.id, 0);
    for (const r of dataset.relations) {
      m.set(r.source, (m.get(r.source) ?? 0) + 1);
      m.set(r.target, (m.get(r.target) ?? 0) + 1);
    }
    return m;
  }, [dataset]);

  // ── 稳定的节点对象 — 仅 dataset 变化时重建 ──
  const nodes = useMemo<GraphNode[]>(() => {
    const unsorted: GraphNode[] = [
      ...dataset.characters.map((c): CharacterGraphNode => ({ id: c.id, kind: "character", entity: c })),
      ...dataset.artifacts.map((a): ArtifactGraphNode => ({
        id: a.id,
        kind: "artifact",
        entity: a,
        eraLayer: artifactEraMap.get(a.id) ?? 2,
      })),
    ];

    return unsorted.sort((a, b) => {
      const da = degreeMap.get(a.id) ?? 0;
      const db = degreeMap.get(b.id) ?? 0;
      if (db !== da) return db - da;
      const eraA = a.kind === "character" ? a.entity.era_layer : a.eraLayer;
      const eraB = b.kind === "character" ? b.entity.era_layer : b.eraLayer;
      if (eraA !== eraB) return eraA - eraB;
      return a.id.localeCompare(b.id);
    });
  }, [dataset.characters, dataset.artifacts, artifactEraMap, degreeMap]);
  const artifactIdSet = useMemo(
    () => new Set(dataset.artifacts.map((a) => a.id)),
    [dataset.artifacts],
  );

  // ── 边数据 ──
  const links = useMemo<GraphLink[]>(() => {
    const nodeIds = new Set([...dataset.characters.map((c) => c.id), ...dataset.artifacts.map((a) => a.id)]);
    return dataset.relations
      .filter((r) => nodeIds.has(r.source) && nodeIds.has(r.target))
      .map((r) => ({ id: r.id, source: r.source, target: r.target, rel: r }));
  }, [dataset.characters, dataset.artifacts, dataset.relations]);
  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  // ── 启动 zoom-to-fit 已移除：加载即进入巡游模式，由巡游接管相机 ──

  // react-force-graph 的默认力参数更适合小圆点；这里节点包含头像、halo 和中文标签，
  // 需要更大的节点间距，否则全图会在 fit 前先挤成一团。
  useEffect(() => {
    if (!graphReady || !fgRef.current) return;
    fgRef.current.d3Force("charge")?.strength(NORMAL_CHARGE_STRENGTH);
    fgRef.current.d3Force("link")?.distance((raw: GraphLink) => {
      const sourceId = typeof raw.source === "object" ? raw.source.id : raw.source;
      const targetId = typeof raw.target === "object" ? raw.target.id : raw.target;
      const sourceIsArtifact = artifactIdSet.has(sourceId);
      const targetIsArtifact = artifactIdSet.has(targetId);
      return sourceIsArtifact || targetIsArtifact ? ARTIFACT_LINK_DISTANCE : NORMAL_LINK_DISTANCE;
    });
    fgRef.current.d3ReheatSimulation();
  }, [graphReady, links, artifactIdSet]);

  // ── 聚焦时计算邻居集合 ──
  const neighborSet = useMemo(() => {
    const s = new Set<string>();
    if (!focusedId) return s;
    for (const r of dataset.relations) {
      if (r.source === focusedId) s.add(r.target);
      if (r.target === focusedId) s.add(r.source);
    }
    return s;
  }, [focusedId, dataset.relations]);

  // ── 应用布局：聚焦模式 > 过滤平铺态 > 普通 layoutMode ──
  useEffect(() => {
    if (!graphReady || !fgRef.current) return;

    if (focusedId) {
      setInitialFitReady(false);
      // 聚焦模式：聚焦节点钉在原点，邻居圆环排布
      const focused = nodes.find((n) => n.id === focusedId);
      if (!focused) return;
      const neighbors = nodes.filter((n) => neighborSet.has(n.id));

      focused.fx = 0;
      focused.fy = 0;
      focused.fz = 0;

      const radius = FOCUS_RADIUS_BASE + neighbors.length * FOCUS_RADIUS_PER_NEIGHBOR;
      neighbors.forEach((n, i) => {
        const angle = (i / Math.max(1, neighbors.length)) * Math.PI * 2 - Math.PI / 2;
        n.fx = radius * Math.cos(angle);
        n.fy = radius * Math.sin(angle);
        n.fz = 0;
      });

      // 隐藏节点 — 解开锁定（虽然不渲染，但避免占据位置影响后续）
      nodes.forEach((n) => {
        if (n.id !== focusedId && !neighborSet.has(n.id)) {
          n.fx = undefined;
          n.fy = undefined;
          n.fz = undefined;
        }
      });

      fgRef.current.d3ReheatSimulation();

      // 相机平滑飞到聚焦视角
      const camDist = Math.max(180, radius * 2.8);
      setTimeout(() => {
        fgRef.current?.cameraPosition(
          { x: 0, y: 0, z: camDist },
          { x: 0, y: 0, z: 0 },
          900,
        );
      }, 50);
    } else if (matchedIds) {
      setInitialFitReady(false);
      // 过滤平铺态:把命中集按连通分量分组,每组中心+圆环;多个子图 bin-pack
      // ── 1) 收集命中节点 + 仅"两端都命中"的边
      const hitNodes = nodes.filter((n) => matchedIds.has(n.id));
      const localAdj = new Map<string, Set<string>>();
      for (const id of matchedIds) localAdj.set(id, new Set());
      for (const r of dataset.relations) {
        if (matchedIds.has(r.source) && matchedIds.has(r.target)) {
          localAdj.get(r.source)!.add(r.target);
          localAdj.get(r.target)!.add(r.source);
        }
      }

      // ── 2) DFS 求连通分量
      const visited = new Set<string>();
      const components: string[][] = [];
      for (const id of matchedIds) {
        if (visited.has(id)) continue;
        const stack = [id];
        const comp: string[] = [];
        while (stack.length) {
          const cur = stack.pop()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          comp.push(cur);
          for (const nb of localAdj.get(cur) ?? []) {
            if (!visited.has(nb)) stack.push(nb);
          }
        }
        components.push(comp);
      }

      // ── 3) 分:子图(>=2) + 孤点(==1)
      const subgraphs = components
        .filter((c) => c.length >= 2)
        .sort((a, b) => b.length - a.length);
      const loners = components.filter((c) => c.length === 1).map((c) => c[0]);

      // ── 4) 计算每个子图的尺寸 + 中心节点
      type SubLayout = {
        ids: string[];
        centerId: string;
        radius: number; // 圆环半径
        boxSize: number; // 占位方块边长(留给 bin-pack)
      };
      const NODE_FOOTPRINT = 18; // 头像约 12-24,圆环上节点边缘需要的额外间距
      const subLayouts: SubLayout[] = subgraphs.map((ids) => {
        // 中心:子图内度数(localAdj)最高
        let centerId = ids[0];
        let bestDeg = -1;
        for (const id of ids) {
          const d = localAdj.get(id)?.size ?? 0;
          if (d > bestDeg) {
            bestDeg = d;
            centerId = id;
          }
        }
        const neighborCount = ids.length - 1;
        const radius = FOCUS_RADIUS_BASE + neighborCount * FOCUS_RADIUS_PER_NEIGHBOR;
        const boxSize = (radius + NODE_FOOTPRINT) * 2;
        return { ids, centerId, radius, boxSize };
      });

      // ── 5) bin-pack 子图:简单的 shelf-packing(行式装箱),按 boxSize 降序填入有限宽度
      //    估算画布宽度:基于子图总面积取 sqrt 上界
      const totalArea = subLayouts.reduce((s, sg) => s + sg.boxSize * sg.boxSize, 0);
      const canvasWidth = Math.max(
        ...subLayouts.map((sg) => sg.boxSize),
        Math.sqrt(totalArea) * 1.2,
        300,
      );
      const PADDING = 30; // 子图区域之间间距
      const positions = new Map<string, { cx: number; cy: number }>();
      let rowX = 0;
      let rowY = 0;
      let rowH = 0;
      for (const sg of subLayouts) {
        if (rowX > 0 && rowX + sg.boxSize > canvasWidth) {
          rowY += rowH + PADDING;
          rowX = 0;
          rowH = 0;
        }
        positions.set(sg.centerId, {
          cx: rowX + sg.boxSize / 2,
          cy: rowY + sg.boxSize / 2,
        });
        rowX += sg.boxSize + PADDING;
        rowH = Math.max(rowH, sg.boxSize);
      }
      const subgraphAreaH = rowY + rowH;

      // ── 6) 应用子图位置:中心 fix 到 (cx, -cy)(注意 y 向上,行向下生长 → 取负),邻居在圆环
      hitNodes.forEach((n) => {
        n.fx = undefined;
        n.fy = undefined;
        n.fz = undefined;
      });
      for (const sg of subLayouts) {
        const pos = positions.get(sg.centerId);
        if (!pos) continue;
        const center = hitNodes.find((n) => n.id === sg.centerId);
        if (!center) continue;
        center.fx = pos.cx;
        center.fy = -pos.cy;
        center.fz = 0;
        center.x = center.fx;
        center.y = center.fy;
        center.z = center.fz;
        const others = sg.ids.filter((id) => id !== sg.centerId);
        others.forEach((id, i) => {
          const n = hitNodes.find((x) => x.id === id);
          if (!n) return;
          const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
          n.fx = pos.cx + sg.radius * Math.cos(angle);
          n.fy = -pos.cy + sg.radius * Math.sin(angle);
          n.fz = 0;
          n.x = n.fx;
          n.y = n.fy;
          n.z = n.fz;
        });
      }

      // ── 7) 孤点区:画布底部一个大圆,均匀分布
      if (loners.length > 0) {
        const lonerCx = canvasWidth / 2;
        const lonerCy = subgraphAreaH + PADDING * 2;
        const lonerRadius = Math.max(
          FOCUS_RADIUS_BASE,
          (loners.length * NODE_FOOTPRINT * 1.6) / (Math.PI * 2),
        );
        loners.forEach((id, i) => {
          const n = hitNodes.find((x) => x.id === id);
          if (!n) return;
          if (loners.length === 1) {
            n.fx = lonerCx;
            n.fy = -lonerCy;
            n.fz = 0;
            n.x = n.fx;
            n.y = n.fy;
            n.z = n.fz;
          } else {
            const angle = (i / loners.length) * Math.PI * 2 - Math.PI / 2;
            n.fx = lonerCx + lonerRadius * Math.cos(angle);
            n.fy = -lonerCy + lonerRadius * Math.sin(angle);
            n.fz = 0;
            n.x = n.fx;
            n.y = n.fy;
            n.z = n.fz;
          }
        });
      }

      // ── 8) 解锁非命中节点(虽然不渲染,避免占位)
      nodes.forEach((n) => {
        if (!matchedIds.has(n.id)) {
          n.fx = undefined;
          n.fy = undefined;
          n.fz = undefined;
        }
      });

      fgRef.current.d3ReheatSimulation();
      // 镜头:过滤平铺态强制俯视 + 对命中节点 bounding box 做 Zoom to Fit。
      // 不用 zoomToFit:react-force-graph 在 force tick 尚未更新 x/y/z 时会按旧/全局坐标 fit,导致画面被拉得过远。
      setTimeout(() => {
        if (!fgRef.current || hitNodes.length === 0) return;
        const xs = hitNodes.map((n) => n.x ?? n.fx ?? 0);
        const ys = hitNodes.map((n) => n.y ?? n.fy ?? 0);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const worldW = Math.max(80, maxX - minX + 140);
        const worldH = Math.max(80, maxY - minY + 140);
        const aspect = size.w / Math.max(1, size.h);
        const fov = (50 * Math.PI) / 180;
        const halfTan = Math.tan(fov / 2);
        const distForH = (worldH / 2) / halfTan;
        const distForW = (worldW / 2) / (halfTan * aspect);
        const dist = Math.max(120, distForH, distForW);
        fgRef.current.cameraPosition(
          { x: cx, y: cy, z: dist },
          { x: cx, y: cy, z: 0 },
          900,
        );
      }, 100);
    } else {
      setInitialFitReady(false);
      // 普通模式：根据 layoutMode 重置锁定
      const isolatedNodes: GraphNode[] = [];
      nodes.forEach((n) => {
        const isIsolated = (degreeMap.get(n.id) ?? 0) === 0;
        if (isIsolated) {
          isolatedNodes.push(n);
          return;
        }
        n.fx = undefined;
        n.fy = layoutMode === "tier" ? tierYForNode(n) : undefined;
        n.fz = undefined;
      });

      // 无连接节点在力学布局中只受斥力影响，容易被推成离群点并拖远全图 fit。
      // 固定到主图右侧的浅弧线上，仍然可见，但不让它决定整体缩放。
      isolatedNodes.forEach((n, i) => {
        const angle = isolatedNodes.length === 1
          ? 0
          : (i / isolatedNodes.length) * Math.PI * 2;
        const radius = 105 + Math.floor(i / 8) * 38;
        n.fx = 170 + Math.cos(angle) * radius;
        n.fy = layoutMode === "tier" ? tierYForNode(n) : Math.sin(angle) * radius * 0.35;
        n.fz = Math.sin(angle) * radius;
        n.x = n.fx;
        n.y = n.fy;
        n.z = n.fz;
      });
      fgRef.current.d3ReheatSimulation();

      // 相机回到全局视图。不用 zoomToFit，避免 force tick 尚未稳定或离群点导致缩放过远。
      const timer = setTimeout(() => {
        if (!fgRef.current) return;
        const fitNodes = nodes.filter((n) => {
          if (n.kind === "character" && !enabledCategories.has(n.entity.category)) return false;
          if (n.kind === "artifact" && !enabledArtifactCategories.has(n.entity.category)) return false;
          if ((degreeMap.get(n.id) ?? 0) < minDegree) return false;
          return true;
        });
        if (fitNodes.length === 0) return;

        const fitNodeIds = new Set(fitNodes.map((n) => n.id));
        const fitAdj = new Map<string, Set<string>>();
        for (const n of fitNodes) fitAdj.set(n.id, new Set());
        for (const r of dataset.relations) {
          if (!fitNodeIds.has(r.source) || !fitNodeIds.has(r.target)) continue;
          fitAdj.get(r.source)?.add(r.target);
          fitAdj.get(r.target)?.add(r.source);
        }

        const visited = new Set<string>();
        const components: GraphNode[][] = [];
        const nodeById = new Map(fitNodes.map((n) => [n.id, n]));
        for (const n of fitNodes) {
          if (visited.has(n.id)) continue;
          const stack = [n.id];
          const comp: GraphNode[] = [];
          while (stack.length > 0) {
            const id = stack.pop()!;
            if (visited.has(id)) continue;
            visited.add(id);
            const node = nodeById.get(id);
            if (node) comp.push(node);
            for (const nb of fitAdj.get(id) ?? []) {
              if (!visited.has(nb)) stack.push(nb);
            }
          }
          if (comp.length > 0) components.push(comp);
        }

        // 有边的小连通分量同样会被力导向推远；fit 前把非主岛整体收拢到主岛右侧的近邻区域。
        const connectedComponents = components
          .filter((comp) => comp.some((n) => (degreeMap.get(n.id) ?? 0) > 0))
          .sort((a, b) => {
            if (b.length !== a.length) return b.length - a.length;
            const da = a.reduce((sum, n) => sum + (degreeMap.get(n.id) ?? 0), 0);
            const db = b.reduce((sum, n) => sum + (degreeMap.get(n.id) ?? 0), 0);
            return db - da;
          });

        const mainComponent = connectedComponents[0] ?? [];
        const satelliteComponents = connectedComponents.slice(1);
        if (mainComponent.length > 0 && satelliteComponents.length > 0) {
          const mainCoords = mainComponent.map(nodeCoord);
          const mainMinX = Math.min(...mainCoords.map((p) => p.x));
          const mainMaxX = Math.max(...mainCoords.map((p) => p.x));
          const mainMinY = Math.min(...mainCoords.map((p) => p.y));
          const mainMaxY = Math.max(...mainCoords.map((p) => p.y));
          const mainCenterY = (mainMinY + mainMaxY) / 2;
          const mainCenterZ = (Math.min(...mainCoords.map((p) => p.z)) + Math.max(...mainCoords.map((p) => p.z))) / 2;
          const mainH = Math.max(120, mainMaxY - mainMinY);
          const bandX = mainMaxX + Math.min(105, Math.max(65, (mainMaxX - mainMinX) * 0.12));
          const rowGap = 54;
          const bandRows = Math.max(3, Math.floor(mainH / rowGap) + 1);

          satelliteComponents.forEach((comp, i) => {
            const coords = comp.map(nodeCoord);
            const minX = Math.min(...coords.map((p) => p.x));
            const maxX = Math.max(...coords.map((p) => p.x));
            const minY = Math.min(...coords.map((p) => p.y));
            const maxY = Math.max(...coords.map((p) => p.y));
            const minZ = Math.min(...coords.map((p) => p.z));
            const maxZ = Math.max(...coords.map((p) => p.z));
            const compCx = (minX + maxX) / 2;
            const compCy = (minY + maxY) / 2;
            const compCz = (minZ + maxZ) / 2;
            const row = i % bandRows;
            const col = Math.floor(i / bandRows);
            const targetCx = bandX + col * 58;
            const targetCy = mainCenterY + (row - (Math.min(bandRows, satelliteComponents.length) - 1) / 2) * rowGap;
            const targetCz = mainCenterZ;
            const dx = targetCx - compCx;
            const dy = targetCy - compCy;
            const dz = targetCz - compCz;

            comp.forEach((n) => {
              const p = nodeCoord(n);
              n.fx = p.x + dx;
              n.fy = layoutMode === "tier" ? tierYForNode(n) : p.y + dy;
              n.fz = p.z + dz;
              n.x = n.fx;
              n.y = n.fy;
              n.z = n.fz;
            });
          });
          fgRef.current.d3ReheatSimulation();
        }

        const connectedFitNodes = fitNodes.filter((n) => (degreeMap.get(n.id) ?? 0) > 0);
        const isolatedFitNodes = fitNodes.filter((n) => (degreeMap.get(n.id) ?? 0) === 0);
        if (connectedFitNodes.length > 0 && isolatedFitNodes.length > 0) {
          const connectedXs = connectedFitNodes.map((n) => n.x ?? n.fx ?? 0);
          const connectedYs = connectedFitNodes.map((n) => n.y ?? n.fy ?? 0);
          const connectedZs = connectedFitNodes.map((n) => n.z ?? n.fz ?? 0);
          const minConnectedX = Math.min(...connectedXs);
          const maxConnectedX = Math.max(...connectedXs);
          const minConnectedY = Math.min(...connectedYs);
          const maxConnectedY = Math.max(...connectedYs);
          const centerX = (minConnectedX + maxConnectedX) / 2;
          const centerY = (minConnectedY + maxConnectedY) / 2;
          const centerZ = (Math.min(...connectedZs) + Math.max(...connectedZs)) / 2;
          const insetX = Math.min(120, Math.max(55, (maxConnectedX - minConnectedX) * 0.2));
          isolatedFitNodes.forEach((n, i) => {
            const row = i % 5;
            const col = Math.floor(i / 5);
            n.fx = centerX + insetX + col * 42;
            n.fy = centerY + (row - (Math.min(5, isolatedFitNodes.length) - 1) / 2) * 52;
            n.fz = centerZ;
            n.x = n.fx;
            n.y = n.fy;
            n.z = n.fz;
          });
          fgRef.current.d3ReheatSimulation();
        }

        const xs = fitNodes.map((n) => n.x ?? n.fx ?? 0);
        const ys = fitNodes.map((n) => n.y ?? n.fy ?? 0);
        const zs = fitNodes.map((n) => n.z ?? n.fz ?? 0);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const minZ = Math.min(...zs);
        const maxZ = Math.max(...zs);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;
        const worldW = Math.max(120, maxX - minX + NORMAL_FIT_PADDING);
        const worldH = Math.max(120, maxY - minY + NORMAL_FIT_PADDING);
        const worldD = Math.max(0, maxZ - minZ);
        const aspect = size.w / Math.max(1, size.h);
        const fov = (50 * Math.PI) / 180;
        const halfTan = Math.tan(fov / 2);
        const distForH = (worldH / 2) / halfTan;
        const distForW = (worldW / 2) / (halfTan * aspect);
        const dist = Math.max(170, distForH, distForW) + worldD * 0.12;
        fgRef.current.cameraPosition(
          { x: cx, y: cy, z: cz + dist },
          { x: cx, y: cy, z: cz },
          900,
        );
        setInitialFitReady(true);
      }, 650);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [
    focusedId,
    neighborSet,
    nodes,
    layoutMode,
    matchedIds,
    dataset.relations,
    size.w,
    size.h,
    degreeMap,
    enabledCategories,
    enabledArtifactCategories,
    minDegree,
    graphReady,
  ]);

  // ── focusNodeId（外部要求把镜头对准某节点，不是聚焦模式）──
  useEffect(() => {
    if (!focusNodeId || !fgRef.current) return;
    const n = nodes.find((x) => x.id === focusNodeId);
    if (!n || n.x === undefined || n.y === undefined) return;
    const distance = 180;
    const dist = Math.hypot(n.x, n.y, n.z || 1);
    const distRatio = 1 + distance / Math.max(1, dist);
    fgRef.current.cameraPosition(
      { x: (n.x ?? 0) * distRatio, y: (n.y ?? 0) * distRatio, z: (n.z ?? 0) * distRatio },
      { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 },
      800,
    );
  }, [focusNodeId, nodes]);

  // ─────────────────────────────────────────────────────────
  // 自动旋转 + 轮播巡游
  // ─────────────────────────────────────────────────────────
  // 鼠标实际交互暂停；停止操作后自动恢复，避免光标停在画布上阻止初始巡游。
  const [tourPaused, setTourPaused] = useState(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const pause = () => {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      setTourPaused(true);
    };
    const scheduleResume = () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => setTourPaused(false), 2000);
    };
    const pauseThenResume = () => {
      pause();
      scheduleResume();
    };
    el.addEventListener("mousedown", pauseThenResume);
    el.addEventListener("wheel", pauseThenResume, { passive: true });
    el.addEventListener("touchstart", pauseThenResume, { passive: true });
    el.addEventListener("mouseleave", scheduleResume);
    return () => {
      el.removeEventListener("mousedown", pauseThenResume);
      el.removeEventListener("wheel", pauseThenResume);
      el.removeEventListener("touchstart", pauseThenResume);
      el.removeEventListener("mouseleave", scheduleResume);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, []);

  // 过滤平铺态下也暂停巡游(避免镜头旋转脱离俯视)
  const tourActive = autoTour && initialFitReady && !tourPaused && !focusedId && !matchedIds;

  // 邻接表：用于 DFS 巡游
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of dataset.characters) m.set(c.id, new Set());
    for (const r of dataset.relations) {
      m.get(r.source)?.add(r.target);
      m.get(r.target)?.add(r.source);
    }
    return m;
  }, [dataset]);

  // 可见节点 id 集合（用于巡游和 DFS 过滤）
  // 三层 AND:类别 ∧ 度数 ∧ (无搜索 / 在命中集中)
  const visibleIdSet = useMemo(() => {
    return new Set(
      nodes
        .filter((n) => {
          if (n.kind === "character" && !enabledCategories.has(n.entity.category)) return false;
          if (n.kind === "artifact" && !enabledArtifactCategories.has(n.entity.category)) return false;
          if ((degreeMap.get(n.id) ?? 0) < minDegree) return false;
          if (matchedIds && !matchedIds.has(n.id)) return false;
          return true;
        })
        .map((n) => n.id),
    );
  }, [nodes, enabledCategories, enabledArtifactCategories, minDegree, degreeMap, matchedIds]);

  // 巡游序列：从度数最高的节点开始，DFS 遍历可见连通分量；多个分量按度数降序衔接
  const tourSequence = useMemo<GraphNode[]>(() => {
    const visible = nodes.filter((n) => visibleIdSet.has(n.id));
    if (visible.length === 0) return [];

    // 按度数降序排序（度数相同时按 era_layer 再按 id 稳定排序）
    const byDegree = [...visible].sort((a, b) => {
      const da = degreeMap.get(a.id) ?? 0;
      const db = degreeMap.get(b.id) ?? 0;
      if (db !== da) return db - da;
      const eraA = a.kind === "character" ? a.entity.era_layer : a.eraLayer;
      const eraB = b.kind === "character" ? b.entity.era_layer : b.eraLayer;
      if (eraA !== eraB) return eraA - eraB;
      return a.id.localeCompare(b.id);
    });

    const seen = new Set<string>();
    const order: GraphNode[] = [];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    // DFS：每次进入新节点时把所有可见邻居按度数降序压栈
    const dfs = (startId: string) => {
      const stack: string[] = [startId];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        if (!visibleIdSet.has(id)) continue;
        seen.add(id);
        const node = nodeById.get(id);
        if (node) order.push(node);

        const neighbors = Array.from(adjacency.get(id) ?? new Set<string>())
          .filter((nid) => visibleIdSet.has(nid) && !seen.has(nid))
          // 升序排序后压栈 → 弹栈时按降序（度数最高的先访问）
          .sort((a, b) => {
            const da = degreeMap.get(a) ?? 0;
            const db = degreeMap.get(b) ?? 0;
            if (da !== db) return da - db;
            return b.localeCompare(a);
          });
        for (const nid of neighbors) stack.push(nid);
      }
    };

    // 主循环：按度数降序的种子节点逐个启动 DFS（处理多个连通分量）
    for (const seed of byDegree) {
      if (!seen.has(seed.id)) dfs(seed.id);
    }

    return order;
  }, [nodes, visibleIdSet, adjacency, degreeMap]);

  useEffect(() => {
    const priorityUrls = tourSequence.slice(0, 12).map((n) => n.entity.thumb);
    preloadImageUrls(priorityUrls);
    for (const url of priorityUrls) getThumbTexture(url);
  }, [tourSequence]);

  // 旋转：每帧把相机绕 Y 轴旋转（6°/秒）
  useEffect(() => {
    if (!tourActive) return;
    let raf = 0;
    let lastT = performance.now();
    const ROTATION_DEG_PER_SEC = 6;

    const tick = (t: number) => {
      const dt = (t - lastT) / 1000;
      lastT = t;
      const cam = fgRef.current?.camera?.();
      if (cam) {
        const angle = (ROTATION_DEG_PER_SEC * Math.PI / 180) * dt;
        // 绕 Y 轴旋转相机位置（保持注视原点不变）
        const x = cam.position.x;
        const z = cam.position.z;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        cam.position.x = x * cos - z * sin;
        cam.position.z = x * sin + z * cos;
        cam.lookAt(0, 0, 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tourActive]);

  // 轮播：每 3 秒切到下一个可见节点放大
  const [tourIndex, setTourIndex] = useState(0);
  useEffect(() => {
    if (!tourActive || tourSequence.length === 0) return;

    let cancelled = false;

    // 巡游镜头固定距离 — 保证中心节点（含上下文字 ~35 单位）完整可见
    // react-force-graph 默认 fov=50°，35 / tan(25°) ≈ 75；取 120 留余量
    const TOUR_CAM_DISTANCE = 120;

    const focusOnIndex = (idx: number) => {
      const node = tourSequence[idx % tourSequence.length] as unknown as {
        x?: number; y?: number; z?: number;
      };
      if (!fgRef.current || node.x === undefined || node.y === undefined) return;
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const nz = node.z ?? 0;
      // 从节点位置出发，沿 +Z 方向放置相机（如果节点已经离原点远，相机就放在它"前方"）
      // 为了让镜头切换有视觉连续性，沿当前节点方向向外推
      const dirX = nx, dirY = ny, dirZ = nz || 1;
      const len = Math.hypot(dirX, dirY, dirZ);
      const unitX = dirX / len, unitY = dirY / len, unitZ = dirZ / len;
      fgRef.current.cameraPosition(
        {
          x: nx + unitX * TOUR_CAM_DISTANCE,
          y: ny + unitY * TOUR_CAM_DISTANCE,
          z: nz + unitZ * TOUR_CAM_DISTANCE,
        },
        { x: nx, y: ny, z: nz },
        1200,
      );
    };

    focusOnIndex(tourIndex);

    const timer = setTimeout(() => {
      if (cancelled) return;
      setTourIndex((i) => (i + 1) % tourSequence.length);
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tourActive, tourIndex, tourSequence]);

  // 当前正在巡游的节点 id
  const tourTargetId = tourActive && tourSequence.length > 0
    ? tourSequence[tourIndex % tourSequence.length].id
    : null;

  // ── 可见性 accessor — 聚焦优先,类别 ∧ 度数 ∧ 搜索命中 次之 ──
  const nodeVisibility = useCallback(
    (raw: object) => {
      const n = raw as GraphNode;
      if (bypassFilters) return true;
      // 聚焦模式：只显示聚焦节点及其邻居（豁免所有过滤）
      if (focusedId) {
        return n.id === focusedId || neighborSet.has(n.id);
      }
      // 普通模式 / 过滤平铺态:类别 ∧ 度数 ∧ 搜索命中
      if (n.kind === "character" && !enabledCategories.has(n.entity.category)) return false;
      if (n.kind === "artifact" && !enabledArtifactCategories.has(n.entity.category)) return false;
      if ((degreeMap.get(n.id) ?? 0) < minDegree) return false;
      if (matchedIds && !matchedIds.has(n.id)) return false;
      return true;
    },
    [bypassFilters, focusedId, neighborSet, enabledCategories, enabledArtifactCategories, minDegree, degreeMap, matchedIds],
  );

  const linkVisibility = useCallback(
    (raw: object) => {
      const l = raw as GraphLink;
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      if (bypassFilters) return true;
      // 聚焦模式：只显示与聚焦节点相关的边
      if (focusedId) {
        return sId === focusedId || tId === focusedId;
      }
      // 普通模式 / 过滤平铺态:两端都通过 类别 ∧ 度数 ∧ 搜索命中
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const src = nodeById.get(sId);
      const tgt = nodeById.get(tId);
      if (!src || !tgt) return false;
      if (src.kind === "character" && !enabledCategories.has(src.entity.category)) return false;
      if (src.kind === "artifact" && !enabledArtifactCategories.has(src.entity.category)) return false;
      if (tgt.kind === "character" && !enabledCategories.has(tgt.entity.category)) return false;
      if (tgt.kind === "artifact" && !enabledArtifactCategories.has(tgt.entity.category)) return false;
      if ((degreeMap.get(sId) ?? 0) < minDegree) return false;
      if ((degreeMap.get(tId) ?? 0) < minDegree) return false;
      if (matchedIds && (!matchedIds.has(sId) || !matchedIds.has(tId))) return false;
      return true;
    },
    [bypassFilters, focusedId, nodes, enabledCategories, enabledArtifactCategories, minDegree, degreeMap, matchedIds],
  );

  // ── 自定义节点 ──
  const createNodeVisual = useCallback(
    (node: GraphNode, mode: NodeVisualMode) => {
      const group = new THREE.Group();
      const isSelected = mode === "selected";
      const isHighlighted = mode === "highlighted";
      const changeKind = whatIfNodeChanges?.get(node.id);
      const isRemoved = changeKind === "removed";
      const entity = node.entity;
      // 是否需要绝对置顶（中心节点）— 巡游/聚焦的中心节点不被任何其他节点遮挡
      const topMost = isHighlighted;
      const baseColor = new THREE.Color(
        isRemoved
          ? "#8a8a8a"
          : node.kind === "character"
          ? characterCategoryColor(node.entity.category)
          : artifactCategoryColor(node.entity.category),
      );
      const lightPortraits = config.nodeVisualTheme === "lightPortraits";

      // 头像尺寸（半身像 2:3）
      //   中心节点（巡游 / focus 中心）显著放大，其他节点同步缩小，形成 3x 视觉对比
      //   目的：让屏幕中心节点鹤立鸡群，避免其下方文字被周围节点图片侵占
      const spriteW = isHighlighted ? 24 : isSelected ? 13 : 8;
      const spriteH = spriteW * 1.5;
      const spriteCenterY = isHighlighted ? 2.5 : isSelected ? 1.2 : 0;
      // 头像下沿 Y 坐标 = 中心 - 半高
      const spriteBottomY = spriteCenterY - spriteH / 2;
      // 名字标签位置：始终在头像下沿之下，留较大间隙避免视觉粘连
      const labelTextHeight = isHighlighted ? 6.5 : 4.5;
      const labelGap = isHighlighted ? 4 : 3;
      const labelY = spriteBottomY - labelTextHeight / 2 - labelGap;
      // 称号位置：名字下方拉开足够间距（label 整体高度 + 间距）
      const epiTextHeight = isHighlighted ? 3.2 : 2.4;
      const epiY = labelY - labelTextHeight - 1.8;

      // 1) 背后彩色 halo
      const haloMat = new THREE.SpriteMaterial({
        map: getHaloTexture(),
        color: baseColor,
        transparent: true,
        opacity: lightPortraits
          ? isHighlighted ? 0.34 : isSelected ? 0.26 : 0.16
          : isHighlighted ? 1 : isSelected ? 0.85 : 0.55,
        depthWrite: false,
        depthTest: false,        // 不参与深度遮挡
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMat);
      const haloScale = lightPortraits
        ? isHighlighted ? 38 : isSelected ? 20 : 12
        : isHighlighted ? 48 : isSelected ? 26 : 16;
      halo.scale.set(haloScale, haloScale, 1);
      halo.position.z = -0.3;
      halo.renderOrder = topMost ? 9990 : 500;
      group.add(halo);

      // 2) 头像 — Plane（手动 billboard：每帧让 plane 朝向相机）
      //    中心节点必须 transparent:true，才能进入"透明队列"压在其他节点的 SpriteText 文字标签之上
      //    （three.js 渲染顺序：opaque queue → transparent queue，renderOrder 只在同一队列内有效）
      if (changeKind) {
        const frameColor = changeKind === "added"
          ? "#d92d20"
          : changeKind === "modified"
            ? "#f4c430"
            : "#777777";
        const frameGeo = new THREE.PlaneGeometry(spriteW + 2.4, spriteH + 2.4);
        const frameMat = new THREE.MeshBasicMaterial({
          color: frameColor,
          transparent: true,
          opacity: changeKind === "removed" ? 0.72 : 1,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(0, spriteCenterY, 0.14);
        frame.renderOrder = topMost ? 9990 : 599;
        frame.onBeforeRender = (_r, _s, camera) => {
          setCameraPlaneTransform(frame, camera, spriteCenterY, 0.14);
        };
        group.add(frame);
      }

      const tex = getThumbTexture(entity.thumb);
      if (tex) {
        if (lightPortraits) {
          const backingGeo = new THREE.PlaneGeometry(spriteW * 1.05, spriteH * 1.04);
          const backingMat = new THREE.MeshBasicMaterial({
            color: 0x5f4636,
            transparent: true,
            opacity: isHighlighted ? 0.34 : isSelected ? 0.28 : 0.22,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const backing = new THREE.Mesh(backingGeo, backingMat);
          backing.position.set(0, spriteCenterY - 0.15, 0.08);
          backing.renderOrder = topMost ? 9990 : 599;
          backing.onBeforeRender = (_r, _s, camera) => {
            setCameraPlaneTransform(backing, camera, spriteCenterY - 0.15, 0.08);
          };
          group.add(backing);

          const outlineGeo = new THREE.PlaneGeometry(spriteW * 1.015, spriteH * 1.015);
          const outlineMat = new THREE.MeshBasicMaterial({
            color: 0x6f533f,
            transparent: true,
            opacity: isHighlighted ? 0.55 : isSelected ? 0.42 : 0.34,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const outline = new THREE.Mesh(outlineGeo, outlineMat);
          outline.position.set(0, spriteCenterY, 0.12);
          outline.renderOrder = topMost ? 9990 : 599;
          outline.onBeforeRender = (_r, _s, camera) => {
            setCameraPlaneTransform(outline, camera, spriteCenterY, 0.12);
          };
          group.add(outline);
        }

        const planeGeo = new THREE.PlaneGeometry(spriteW, spriteH);
        const planeMat = isRemoved
          ? new THREE.ShaderMaterial({
              uniforms: { map: { value: tex } },
              vertexShader: `
                varying vec2 vUv;
                void main() {
                  vUv = uv;
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              `,
              fragmentShader: `
                uniform sampler2D map;
                varying vec2 vUv;
                void main() {
                  vec4 pixel = texture2D(map, vUv);
                  float gray = dot(pixel.rgb, vec3(0.299, 0.587, 0.114));
                  gl_FragColor = vec4(vec3(gray * 0.72), pixel.a * 0.82);
                }
              `,
              transparent: true,
              depthTest: false,
              depthWrite: false,
              side: THREE.DoubleSide,
            })
          : new THREE.MeshBasicMaterial({
              map: tex,
              transparent: topMost || lightPortraits,
              alphaTest: 0,
              depthTest: false,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.set(0, spriteCenterY, 0.2);
        plane.renderOrder = topMost ? 9991 : 600;
        // Mesh 不会自动 billboard；同时按相机屏幕坐标重算偏移，保证标签始终在图像下方。
        plane.onBeforeRender = (_r, _s, camera) => {
          setCameraPlaneTransform(plane, camera, spriteCenterY, 0.2);
        };
        group.add(plane);
      } else {
        const placeholderGeo = new THREE.PlaneGeometry(spriteW, spriteH);
        const placeholderMat = new THREE.MeshBasicMaterial({
          color: isRemoved ? "#a3a3a3" : "#eee9e1",
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
        placeholder.position.set(0, spriteCenterY, 0.2);
        placeholder.renderOrder = topMost ? 9991 : 600;
        placeholder.onBeforeRender = (_r, _s, camera) => {
          setCameraPlaneTransform(placeholder, camera, spriteCenterY, 0.2);
        };
        group.add(placeholder);
      }

      // 3) 落地阴影 — 跟随头像下沿
      const shadowMat = new THREE.SpriteMaterial({
        map: getShadowTexture(),
        color: 0x000000,
        transparent: true,
        opacity: lightPortraits ? 0.28 : 0.45,
        depthWrite: false,
        depthTest: false,
      });
      const shadow = new THREE.Sprite(shadowMat);
      const shadowW = lightPortraits
        ? isHighlighted ? 36 : isSelected ? 16 : 10
        : isHighlighted ? 32 : 11;
      const shadowY = lightPortraits ? spriteCenterY - 0.35 : spriteBottomY - 1;
      shadow.scale.set(shadowW, shadowW * (lightPortraits ? 0.62 : 0.25), 1);
      shadow.position.set(0, shadowY, -0.2);
      shadow.renderOrder = topMost ? 9989 : 499;
      shadow.onBeforeRender = (_r, _s, camera) => {
        setCameraPlaneTransform(shadow, camera, shadowY, -0.2);
      };
      group.add(shadow);

      // 4) 名字 — 中心节点用 opaque plane（保证在边/箭头之上），普通节点用 SpriteText（轻量）
      if (topMost) {
        const labelPx = 64;
        const { texture: labelTex, aspect: labelAspect } = getLabelTexture(
          entity.name_zh,
          isRemoved ? "#666666" : COLOR.text,
          "rgba(255,255,255,0.95)",
          FONT.serif,
          "600",
          labelPx,
        );
        const labelH = labelTextHeight * 1.4;       // 含 padding
        const labelW = labelH * labelAspect;
        const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
        const labelMat = new THREE.MeshBasicMaterial({
          map: labelTex,
          transparent: true,        // 走透明队列 + renderOrder=9992 → 永远盖住其他节点的 SpriteText
          alphaTest: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const labelMesh = new THREE.Mesh(labelGeo, labelMat);
        labelMesh.position.set(0, labelY, 0);
        labelMesh.renderOrder = 9992;
        labelMesh.onBeforeRender = (_r, _s, camera) => {
          setCameraPlaneTransform(labelMesh, camera, labelY);
        };
        group.add(labelMesh);
      } else {
        const label = new SpriteText(entity.name_zh);
        label.color = isRemoved ? "#666666" : COLOR.text;
        label.backgroundColor = "rgba(255,255,255,0.92)";
        label.padding = 2;
        label.borderRadius = 3;
        label.fontFace = FONT.serif;
        label.fontSize = 64;
        label.fontWeight = "600";
        label.textHeight = labelTextHeight;
        label.position.set(0, labelY, 0);
        label.material.depthTest = false;
        label.material.depthWrite = false;
        label.renderOrder = 601;
        label.onBeforeRender = (_r, _s, camera) => {
          setCameraPlaneTransform(label, camera, labelY);
        };
        group.add(label);
      }

      // 5) 称号
      if (entity.epithet) {
        if (topMost) {
          const r = Math.round(baseColor.r * 220);
          const g = Math.round(baseColor.g * 220);
          const b = Math.round(baseColor.b * 220);
          const epiPx = 40;
          const { texture: epiTex, aspect: epiAspect } = getLabelTexture(
            entity.epithet,
            `rgb(${r},${g},${b})`,
            "rgba(255,255,255,0.88)",
            FONT.sans,
            "400",
            epiPx,
          );
          const epiH = epiTextHeight * 1.4;
          const epiW = epiH * epiAspect;
          const epiGeo = new THREE.PlaneGeometry(epiW, epiH);
          const epiMat = new THREE.MeshBasicMaterial({
            map: epiTex,
            transparent: true,        // 同上：走透明队列，靠 renderOrder 压制
            alphaTest: 0,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const epiMesh = new THREE.Mesh(epiGeo, epiMat);
          epiMesh.position.set(0, epiY, 0);
          epiMesh.renderOrder = 9993;
          epiMesh.onBeforeRender = (_r, _s, camera) => {
            setCameraPlaneTransform(epiMesh, camera, epiY);
          };
          group.add(epiMesh);
        } else {
          const epi = new SpriteText(entity.epithet);
          const r = Math.round(baseColor.r * 220);
          const g = Math.round(baseColor.g * 220);
          const b = Math.round(baseColor.b * 220);
          epi.color = `rgb(${r},${g},${b})`;
          epi.backgroundColor = "rgba(255,255,255,0.78)";
          epi.padding = 1.5;
          epi.borderRadius = 2;
          epi.fontFace = FONT.sans;
          epi.fontSize = 40;
          epi.fontWeight = "400";
          epi.textHeight = epiTextHeight;
          epi.position.set(0, epiY, 0);
          epi.material.depthTest = false;
          epi.material.depthWrite = false;
          epi.renderOrder = 601;
          epi.onBeforeRender = (_r, _s, camera) => {
            setCameraPlaneTransform(epi, camera, epiY);
          };
          group.add(epi);
        }
      }

      return group;
    },
    [whatIfNodeChanges, characterCategoryColor, artifactCategoryColor, config.nodeVisualTheme],
  );

  const nodeVisualEntriesRef = useRef(new Map<string, NodeVisualEntry>());
  const nodeVisualStateRef = useRef({ selectedNodeId, focusedId, tourTargetId });
  nodeVisualStateRef.current = { selectedNodeId, focusedId, tourTargetId };

  const visualModeForNode = useCallback((nodeId: string): NodeVisualMode => {
    const state = nodeVisualStateRef.current;
    if (nodeId === state.focusedId || nodeId === state.tourTargetId) return "highlighted";
    if (nodeId === state.selectedNodeId) return "selected";
    return "normal";
  }, []);

  const nodeThreeObject = useCallback(
    (raw: object) => {
      const node = raw as GraphNode;
      const mode = visualModeForNode(node.id);
      const visual = createNodeVisual(node, mode);
      const outer = new THREE.Group();
      outer.add(visual);
      const previous = nodeVisualEntriesRef.current.get(node.id);
      if (previous) {
        for (const variant of previous.variants.values()) disposeNodeVisual(variant);
      }
      nodeVisualEntriesRef.current.set(node.id, {
        outer,
        activeMode: mode,
        variants: new Map([[mode, visual]]),
      });
      return outer;
    },
    [createNodeVisual, visualModeForNode],
  );

  useEffect(() => {
    const liveIds = new Set(nodes.map((node) => node.id));
    for (const id of nodeVisualEntriesRef.current.keys()) {
      if (liveIds.has(id)) continue;
      const entry = nodeVisualEntriesRef.current.get(id);
      if (entry) {
        for (const variant of entry.variants.values()) disposeNodeVisual(variant);
      }
      nodeVisualEntriesRef.current.delete(id);
    }

    for (const node of nodes) {
      const entry = nodeVisualEntriesRef.current.get(node.id);
      if (!entry) continue;
      const mode = visualModeForNode(node.id);
      if (mode === entry.activeMode) continue;
      let visual = entry.variants.get(mode);
      if (!visual) {
        visual = createNodeVisual(node, mode);
        entry.variants.set(mode, visual);
      }
      entry.outer.clear();
      entry.outer.add(visual);
      entry.activeMode = mode;
    }
  }, [nodes, selectedNodeId, focusedId, tourTargetId, createNodeVisual, visualModeForNode]);

  // ── 边的样式 ──
  const linkColor = useCallback(
    (raw: object) => {
      const link = raw as GraphLink;
      if (link.id === selectedEdgeId) return COLOR.accent;
      return relationColor(link.rel.primary_type);
    },
    [selectedEdgeId, relationColor],
  );

  const linkWidth = useCallback(
    (raw: object) => {
      const link = raw as GraphLink;
      const base = Math.min(3, Math.max(0.4, (link.rel.events.length || 1) * 0.6));
      const focusBoost = focusedId ? 2 : 1;
      const selectedBoost = link.id === selectedEdgeId ? 1.5 : 1;
      return base * focusBoost * selectedBoost;
    },
    [selectedEdgeId, focusedId],
  );

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", background: COLOR.bg, position: "relative" }}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={graphData}
          backgroundColor={COLOR.bg}
          nodeThreeObject={nodeThreeObject}
          nodeLabel={(raw: object) => `${(raw as GraphNode).entity.name_zh} · ${(raw as GraphNode).entity.name_en}`}
          nodeVisibility={nodeVisibility}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={1}
          linkVisibility={linkVisibility}
          linkDirectionalArrowLength={(raw: object) => ((raw as GraphLink).rel.primary_type === "blood" ? 4 : 0)}
          linkDirectionalArrowRelPos={0.95}
          linkDirectionalArrowColor={linkColor}
          enableNodeDrag={true}
          onNodeClick={(n) => onNodeSelect?.((n as unknown as GraphNode).id)}
          onLinkClick={(l) => onEdgeSelect?.((l as unknown as GraphLink).id)}
          onBackgroundClick={() => onBackgroundClick?.()}
          showNavInfo={false}
          controlType="orbit"
          d3VelocityDecay={0.45}
          warmupTicks={120}
          cooldownTicks={220}
        />
      )}
    </div>
  );
}
