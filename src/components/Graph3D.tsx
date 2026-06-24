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

import type { Dataset, Character, Relation, CharacterCategory } from "@/schemas/character";
import { CATEGORY_COLOR, RELATION_COLOR, COLOR, FONT } from "@/lib/tokens";

// SSR off — three.js 只能在浏览器
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

// ─── 纹理缓存 ───────────────────────────────────────────
const _texCache = new Map<string, THREE.Texture>();
const _texLoader = typeof window !== "undefined" ? new THREE.TextureLoader() : null;

function getThumbTexture(url: string): THREE.Texture | null {
  if (!_texLoader) return null;
  const hit = _texCache.get(url);
  if (hit) return hit;
  const tex = _texLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(url, tex);
  return tex;
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

interface GraphNode {
  id: string;
  ch: Character;
  // 力学引擎用字段（运行时由 d3-force 写入 / 我们覆盖）
  x?: number; y?: number; z?: number;
  fx?: number; fy?: number; fz?: number;
}

interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  rel: Relation;
}

interface Props {
  dataset: Dataset;
  layoutMode: LayoutMode;
  /** 选中态（右侧人物面板）— 与 focusedId 解耦 */
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  /** 聚焦态（中心化+圆环布局） */
  focusedId?: string | null;
  focusNodeId?: string | null;
  /** 当前启用的类别集合 — 不在此集合的节点和相关边将被隐藏（聚焦模式下豁免） */
  enabledCategories: Set<CharacterCategory>;
  /** 度数阈值 — 过滤掉度数 < 阈值的节点（聚焦模式下豁免）。0 = 不过滤 */
  minDegree: number;
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

export function Graph3D({
  dataset,
  layoutMode,
  selectedNodeId,
  selectedEdgeId,
  focusedId = null,
  focusNodeId,
  enabledCategories,
  minDegree,
  autoTour,
  onNodeSelect,
  onEdgeSelect,
  onBackgroundClick,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

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

  // 启动后强制把镜头拉远到能看到所有节点（占位 — fitCameraToAllNodes 定义在 nodes 之后）
  const didInitialFitRef = useRef(false);
  void didInitialFitRef; // 保留 ref 占位但不再使用

  // ── 稳定的节点对象 — 仅 dataset 变化时重建 ──
  const nodes = useMemo<GraphNode[]>(
    () => dataset.characters.map((c) => ({ id: c.id, ch: c })),
    [dataset.characters],
  );

  // ── 边数据 ──
  const links = useMemo<GraphLink[]>(() => {
    const charIds = new Set(dataset.characters.map((c) => c.id));
    return dataset.relations
      .filter((r) => charIds.has(r.source) && charIds.has(r.target))
      .map((r) => ({ id: r.id, source: r.source, target: r.target, rel: r }));
  }, [dataset.characters, dataset.relations]);

  // ── 启动 zoom-to-fit 已移除：加载即进入巡游模式，由巡游接管相机 ──

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

  // ── 度数表：每个节点的入度+出度（基于全数据集，不受类别过滤影响） ──
  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of dataset.characters) m.set(c.id, 0);
    for (const r of dataset.relations) {
      m.set(r.source, (m.get(r.source) ?? 0) + 1);
      m.set(r.target, (m.get(r.target) ?? 0) + 1);
    }
    return m;
  }, [dataset]);

  // ── 应用布局：聚焦模式覆盖 layoutMode ──
  useEffect(() => {
    if (!fgRef.current) return;

    if (focusedId) {
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
    } else {
      // 普通模式：根据 layoutMode 重置锁定
      nodes.forEach((n) => {
        n.fx = undefined;
        n.fy = layoutMode === "tier" ? (3 - n.ch.era_layer) * LAYER_SPACING : undefined;
        n.fz = undefined;
      });
      fgRef.current.d3ReheatSimulation();

      // 相机回到全局视图
      setTimeout(() => {
        fgRef.current?.zoomToFit(900, 60);
      }, 200);
    }
  }, [focusedId, neighborSet, nodes, layoutMode]);

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
  // 鼠标交互暂停（mousedown 即暂停，mouseleave 后 2s 恢复）
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
    el.addEventListener("mousedown", pause);
    el.addEventListener("wheel", pause, { passive: true });
    el.addEventListener("mouseleave", scheduleResume);
    el.addEventListener("mouseenter", pause);
    return () => {
      el.removeEventListener("mousedown", pause);
      el.removeEventListener("wheel", pause);
      el.removeEventListener("mouseleave", scheduleResume);
      el.removeEventListener("mouseenter", pause);
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, []);

  const tourActive = autoTour && !tourPaused && !focusedId;

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
  const visibleIdSet = useMemo(() => {
    return new Set(
      nodes
        .filter((n) => enabledCategories.has(n.ch.category) && (degreeMap.get(n.id) ?? 0) >= minDegree)
        .map((n) => n.id),
    );
  }, [nodes, enabledCategories, minDegree, degreeMap]);

  // 巡游序列：从度数最高的节点开始，DFS 遍历可见连通分量；多个分量按度数降序衔接
  const tourSequence = useMemo<GraphNode[]>(() => {
    const visible = nodes.filter((n) => visibleIdSet.has(n.id));
    if (visible.length === 0) return [];

    // 按度数降序排序（度数相同时按 era_layer 再按 id 稳定排序）
    const byDegree = [...visible].sort((a, b) => {
      const da = degreeMap.get(a.id) ?? 0;
      const db = degreeMap.get(b.id) ?? 0;
      if (db !== da) return db - da;
      if (a.ch.era_layer !== b.ch.era_layer) return a.ch.era_layer - b.ch.era_layer;
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

  // 暂停后重置回 0 — 下次恢复时从头开始
  useEffect(() => {
    if (!tourActive) setTourIndex(0);
  }, [tourActive]);

  // 当前正在巡游的节点 id
  const tourTargetId = tourActive && tourSequence.length > 0
    ? tourSequence[tourIndex % tourSequence.length].id
    : null;

  // ── 可见性 accessor — 聚焦优先，类别 AND 度数次之 ──
  const nodeVisibility = useCallback(
    (raw: object) => {
      const n = raw as GraphNode;
      // 聚焦模式：只显示聚焦节点及其邻居（豁免所有过滤）
      if (focusedId) {
        return n.id === focusedId || neighborSet.has(n.id);
      }
      // 普通模式：类别过滤 AND 度数过滤
      if (!enabledCategories.has(n.ch.category)) return false;
      if ((degreeMap.get(n.id) ?? 0) < minDegree) return false;
      return true;
    },
    [focusedId, neighborSet, enabledCategories, minDegree, degreeMap],
  );

  const linkVisibility = useCallback(
    (raw: object) => {
      const l = raw as GraphLink;
      const sId = typeof l.source === "object" ? l.source.id : l.source;
      const tId = typeof l.target === "object" ? l.target.id : l.target;
      // 聚焦模式：只显示与聚焦节点相关的边
      if (focusedId) {
        return sId === focusedId || tId === focusedId;
      }
      // 普通模式：两端节点都通过过滤（类别 + 度数）才显示
      const srcCh = dataset.characters.find((c) => c.id === sId);
      const tgtCh = dataset.characters.find((c) => c.id === tId);
      if (!srcCh || !tgtCh) return false;
      if (!enabledCategories.has(srcCh.category) || !enabledCategories.has(tgtCh.category)) return false;
      if ((degreeMap.get(sId) ?? 0) < minDegree) return false;
      if ((degreeMap.get(tId) ?? 0) < minDegree) return false;
      return true;
    },
    [focusedId, enabledCategories, minDegree, degreeMap, dataset.characters],
  );

  // ── 自定义节点 ──
  const nodeThreeObject = useCallback(
    (raw: object) => {
      const node = raw as GraphNode;
      const group = new THREE.Group();
      const isSelected = node.id === selectedNodeId;
      const isFocused = node.id === focusedId;
      const isTourTarget = node.id === tourTargetId;
      const isHighlighted = isFocused || isTourTarget;
      // 是否需要绝对置顶（中心节点）— 巡游/聚焦的中心节点不被任何其他节点遮挡
      const topMost = isHighlighted;
      const baseColor = new THREE.Color(CATEGORY_COLOR[node.ch.category]);

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
        opacity: isHighlighted ? 1 : isSelected ? 0.85 : 0.55,
        depthWrite: false,
        depthTest: false,        // 不参与深度遮挡
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMat);
      const haloScale = isHighlighted ? 48 : isSelected ? 26 : 16;
      halo.scale.set(haloScale, haloScale, 1);
      halo.position.z = -0.3;
      halo.renderOrder = topMost ? 9990 : 500;
      group.add(halo);

      // 2) 头像 — Plane（手动 billboard：每帧让 plane 朝向相机）
      //    中心节点必须 transparent:true，才能进入"透明队列"压在其他节点的 SpriteText 文字标签之上
      //    （three.js 渲染顺序：opaque queue → transparent queue，renderOrder 只在同一队列内有效）
      const tex = getThumbTexture(node.ch.thumb);
      if (tex) {
        const planeGeo = new THREE.PlaneGeometry(spriteW, spriteH);
        const planeMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: topMost,       // 中心节点强制走透明队列
          alphaTest: 0,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.set(0, spriteCenterY, 0.2);
        plane.renderOrder = topMost ? 9991 : 600;
        group.add(plane);
      }

      // 3) 落地阴影 — 跟随头像下沿
      const shadowMat = new THREE.SpriteMaterial({
        map: getShadowTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        depthTest: false,
      });
      const shadow = new THREE.Sprite(shadowMat);
      const shadowW = isHighlighted ? 32 : 11;
      shadow.scale.set(shadowW, shadowW * 0.25, 1);
      shadow.position.set(0, spriteBottomY - 1, -0.2);
      shadow.renderOrder = topMost ? 9989 : 499;
      group.add(shadow);

      // 4) 名字 — 中心节点用 opaque plane（保证在边/箭头之上），普通节点用 SpriteText（轻量）
      if (topMost) {
        const labelPx = 64;
        const { texture: labelTex, aspect: labelAspect } = getLabelTexture(
          node.ch.name_zh,
          COLOR.text,
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
        group.add(labelMesh);
      } else {
        const label = new SpriteText(node.ch.name_zh);
        label.color = COLOR.text;
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
        group.add(label);
      }

      // 5) 称号
      if (node.ch.epithet) {
        if (topMost) {
          const r = Math.round(baseColor.r * 220);
          const g = Math.round(baseColor.g * 220);
          const b = Math.round(baseColor.b * 220);
          const epiPx = 40;
          const { texture: epiTex, aspect: epiAspect } = getLabelTexture(
            node.ch.epithet,
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
          group.add(epiMesh);
        } else {
          const epi = new SpriteText(node.ch.epithet);
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
          group.add(epi);
        }
      }

      // ── 整组 billboard：让整个节点 group 始终面向相机 ──
      // 这是解决"任何相机角度下文字都在图片正下方、不被自身或邻居图片遮挡"的关键：
      // group 自身朝相机旋转后，"下方"在屏幕空间始终向下，labelY/epiY 的负偏移
      // 才能稳定呈现在头像下方，而非（在仰视/俯视下）漂移到头像上或与之重合。
      group.onBeforeRender = (_renderer, _scene, camera) => {
        group.quaternion.copy(camera.quaternion);
      };

      return group;
    },
    [selectedNodeId, focusedId, tourTargetId],
  );

  // ── 边的样式 ──
  const linkColor = useCallback(
    (raw: object) => {
      const link = raw as GraphLink;
      if (link.id === selectedEdgeId) return COLOR.accent;
      return RELATION_COLOR[link.rel.primary_type];
    },
    [selectedEdgeId],
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
          graphData={{ nodes, links }}
          backgroundColor={COLOR.bg}
          nodeThreeObject={nodeThreeObject}
          nodeLabel={(raw: object) => `${(raw as GraphNode).ch.name_zh} · ${(raw as GraphNode).ch.name_en}`}
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
          warmupTicks={50}
          cooldownTicks={120}
        />
      )}
    </div>
  );
}
