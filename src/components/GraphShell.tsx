"use client";

/**
 * 主页面客户端壳：3D 图谱 + 互斥选择 + 模式切换 + 类别过滤
 */
import { useMemo, useState } from "react";
import type { Dataset, CharacterCategory } from "@/schemas/character";
import { Graph3D, type LayoutMode } from "./Graph3D";
import { SearchBox } from "./SearchBox";
import { Legend } from "./Legend";
import { Intro } from "./Intro";
import { CATEGORY_LABEL, COLOR, FONT } from "@/lib/tokens";

type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as CharacterCategory[];

export function GraphShell({ dataset }: { dataset: Dataset }) {
  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("tier");
  const [enabledCategories, setEnabledCategories] = useState<Set<CharacterCategory>>(
    () => new Set(ALL_CATEGORIES),
  );
  const [minDegree, setMinDegree] = useState<number>(0);
  // 加载即进入巡游模式
  const [autoTour, setAutoTour] = useState<boolean>(true);

  // 计算每个节点的度数 + 最大度数（用于滑动条上限）
  const degreeInfo = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of dataset.characters) m.set(c.id, 0);
    for (const r of dataset.relations) {
      m.set(r.source, (m.get(r.source) ?? 0) + 1);
      m.set(r.target, (m.get(r.target) ?? 0) + 1);
    }
    const max = Math.max(0, ...Array.from(m.values()));
    return { map: m, max };
  }, [dataset]);

  const character = sel.kind === "node"
    ? dataset.characters.find((c) => c.id === sel.id)
    : null;
  const relation = sel.kind === "edge"
    ? dataset.relations.find((r) => r.id === sel.id)
    : null;
  const relChars = relation
    ? {
        source: dataset.characters.find((c) => c.id === relation.source),
        target: dataset.characters.find((c) => c.id === relation.target),
      }
    : null;

  // 节点点击：首次=进入聚焦+打开详情；再次点同一节点=退出聚焦+关闭详情
  const handleNodeClick = (id: string) => {
    if (focusedId === id) {
      setFocusedId(null);
      setSel({ kind: "none" });
    } else {
      setFocusedId(id);
      setSel({ kind: "node", id });
    }
  };

  // 点击空白：退出聚焦+关闭一切
  const handleBackground = () => {
    setFocusedId(null);
    setSel({ kind: "none" });
  };

  // 点击边：仅选中，不影响聚焦态
  const handleEdgeClick = (id: string) => setSel({ kind: "edge", id });

  // 类别勾选
  const toggleCategory = (cat: CharacterCategory) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const allCategories = () => setEnabledCategories(new Set(ALL_CATEGORIES));
  const noCategories = () => setEnabledCategories(new Set());

  // 缓存 set 给 Graph3D 用，避免每次 render 都重建依赖
  const enabledSet = useMemo(() => enabledCategories, [enabledCategories]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 380px",
        height: "100vh",
        background: COLOR.bg,
        color: COLOR.text,
        fontFamily: FONT.sans,
      }}
    >
      <Intro />
      <div style={{ borderRight: `1px solid ${COLOR.border}`, position: "relative" }}>
        <SearchBox
          characters={dataset.characters}
          onPick={(id) => {
            setSel({ kind: "node", id });
            setFocusId(id);
            setFocusedId(id);
          }}
        />
        <Legend
          enabledCategories={enabledSet}
          onCategoryToggle={toggleCategory}
          onCategoriesAll={allCategories}
          onCategoriesNone={noCategories}
        />
        <LayoutToggle value={layoutMode} onChange={setLayoutMode} />
        <AutoTourToggle value={autoTour} onChange={setAutoTour} />
        <DegreeSlider
          value={minDegree}
          max={degreeInfo.max}
          onChange={setMinDegree}
          visibleCount={
            Array.from(degreeInfo.map.entries()).filter(([, d]) => d >= minDegree).length
          }
          total={dataset.characters.length}
        />
        <Graph3D
          dataset={dataset}
          layoutMode={layoutMode}
          selectedNodeId={sel.kind === "node" ? sel.id : null}
          selectedEdgeId={sel.kind === "edge" ? sel.id : null}
          focusedId={focusedId}
          focusNodeId={focusId}
          enabledCategories={enabledSet}
          minDegree={minDegree}
          autoTour={autoTour}
          onNodeSelect={handleNodeClick}
          onEdgeSelect={handleEdgeClick}
          onBackgroundClick={handleBackground}
        />
      </div>

      <aside
        style={{
          background: COLOR.bgPanel,
          padding: 20,
          overflowY: "auto",
          borderLeft: `1px solid ${COLOR.border}`,
        }}
      >
        {sel.kind === "none" && (
          <div style={{ color: COLOR.textMuted, fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontFamily: FONT.serif, fontSize: 22, color: COLOR.text, marginBottom: 10 }}>
              GreekMyths
            </div>
            希腊神话人物 3D 关系图谱。<br />
            点击节点查看人物详情，点击边查看二人之间的事件链。
            <div style={{ marginTop: 16, fontSize: 12 }}>
              · 鼠标拖动：旋转视角<br />
              · 滚轮：缩放<br />
              · 拖动节点：移动节点位置<br />
              · 左下角：切换分层 / 自由布局
            </div>
            <div style={{ marginTop: 24, fontSize: 12 }}>
              数据：{dataset.characters.length} 人 · {dataset.relations.length} 条关系
            </div>
          </div>
        )}

        {character && (
          <div>
            <div
              style={{
                width: "100%",
                aspectRatio: "2 / 3",
                background: COLOR.bgRaised,
                borderRadius: 8,
                overflow: "hidden",
                marginBottom: 16,
                position: "relative",
                border: `1px solid ${COLOR.border}`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={character.portrait}
                alt={character.name_zh}
                loading="lazy"
                decoding="async"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                  animation: "fadeIn 400ms ease-out",
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
            </div>

            {/* 1. 人名 */}
            <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600 }}>
              {character.name_zh}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: COLOR.textMuted, letterSpacing: "0.1em" }}>
              {character.name_en}
            </div>

            {/* 2. 一句话人物概要（用 epithet） */}
            {character.epithet && (
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px solid ${COLOR.border}`,
                  fontStyle: "italic",
                  color: COLOR.accent,
                  fontSize: 15,
                  lineHeight: 1.5,
                }}
              >
                {character.epithet}
              </div>
            )}

            {/* 3. 名言 */}
            <Section
              title="名言"
              items={character.quotes.length === 0
                ? <em style={{ color: COLOR.textMuted, fontSize: 12 }}>史料无记载</em>
                : character.quotes.map((q, i) => (
                    <blockquote key={i} style={{ borderLeft: `2px solid ${COLOR.accent}`, paddingLeft: 12, margin: "0 0 12px 0" }}>
                      <div style={{ fontFamily: FONT.serif, fontSize: 14, lineHeight: 1.6 }}>{q.text}</div>
                      <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                        —— 《{q.source.work}》{q.source.locus ?? ""}
                      </div>
                    </blockquote>
                  ))}
            />

            {/* 4. 武器 */}
            <KVRow label="武器" values={character.weapons} />

            {/* 5. 技能 */}
            <KVRow label="技能" values={character.skills} />

            {/* 6+7. 神职 / 领域（单一字段，合并显示） */}
            <KVRow label="神职/领域" values={character.domains} />

            {/* 坐骑（保留，原先已有） */}
            <KVRow label="坐骑" values={character.mounts} />

            {/* 8. 人物简介 */}
            {character.bio && (
              <Section
                title="人物简介"
                items={<p style={{ lineHeight: 1.75, fontSize: 14, margin: 0 }}>{character.bio}</p>}
              />
            )}

            {/* 9. 主要事件 */}
            <Section
              title="主要事件"
              items={character.events.map((e) => (
                <div key={e.title} style={{ marginBottom: 12 }}>
                  <strong style={{ color: COLOR.accent, fontSize: 13 }}>{e.title}</strong>
                  <div style={{ fontSize: 13, color: COLOR.textMuted, marginTop: 4, lineHeight: 1.6 }}>
                    {e.desc}
                  </div>
                  {e.source && (
                    <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                      《{e.source.work}》{e.source.locus ?? ""}
                    </div>
                  )}
                </div>
              ))}
            />
          </div>
        )}

        {relation && relChars && (
          <div>
            <div style={{ fontFamily: FONT.serif, fontSize: 20, marginBottom: 4 }}>
              {relChars.source?.name_zh} ↔ {relChars.target?.name_zh}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: COLOR.textMuted }}>
              {relation.primary_type.toUpperCase()}
              {relation.composite_types.length > 0 && (
                <span> + {relation.composite_types.join(", ")}</span>
              )}
            </div>
            <Section title="事件时间线" items={relation.events.map((e, i) => (
              <div key={i} style={{ marginBottom: 14 }}>
                <strong style={{ color: COLOR.accent, fontSize: 13 }}>{e.title}</strong>
                <div style={{ fontSize: 13, color: COLOR.textMuted, marginTop: 4, lineHeight: 1.6 }}>
                  {e.desc}
                </div>
                {e.source && (
                  <div style={{ fontFamily: FONT.mono, fontSize: 10, color: COLOR.textMuted, marginTop: 4 }}>
                    《{e.source.work}》{e.source.locus ?? ""}
                  </div>
                )}
              </div>
            ))} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, items }: { title: string; items: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{
        fontFamily: FONT.mono,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: COLOR.textMuted,
        margin: "0 0 12px 0",
      }}>{title}</h3>
      <div>{items}</div>
    </div>
  );
}

function KVRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <span style={{
        fontFamily: FONT.mono,
        fontSize: 10,
        color: COLOR.textMuted,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        marginRight: 8,
      }}>{label}</span>
      <span style={{ fontSize: 13 }}>{values.join(" · ")}</span>
    </div>
  );
}

function LayoutToggle({
  value,
  onChange,
}: { value: LayoutMode; onChange: (v: LayoutMode) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 20,
        background: "oklch(99% 0 0 / 0.92)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        padding: 4,
        display: "flex",
        gap: 2,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      }}
    >
      <ToggleBtn active={value === "tier"} onClick={() => onChange("tier")}>
        代际分层
      </ToggleBtn>
      <ToggleBtn active={value === "free"} onClick={() => onChange("free")}>
        自由布局
      </ToggleBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: active ? COLOR.text : "transparent",
        color: active ? COLOR.bg : COLOR.textMuted,
        border: "none",
        borderRadius: 5,
        fontSize: 12,
        fontFamily: FONT.sans,
        cursor: "pointer",
        transition: "background 150ms, color 150ms",
      }}
    >
      {children}
    </button>
  );
}

function AutoTourToggle({
  value,
  onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 220,
        zIndex: 20,
        background: "oklch(99% 0 0 / 0.92)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        padding: 4,
        display: "flex",
        gap: 2,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
      }}
    >
      <button
        onClick={() => onChange(!value)}
        title={value ? "暂停自动巡游" : "开始自动旋转 + 轮播"}
        style={{
          padding: "6px 14px",
          background: value ? COLOR.accent : "transparent",
          color: value ? "#fff" : COLOR.textMuted,
          border: "none",
          borderRadius: 5,
          fontSize: 12,
          fontFamily: FONT.sans,
          cursor: "pointer",
          transition: "background 150ms, color 150ms",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 10 }}>{value ? "●" : "○"}</span>
        {value ? "自动巡游中" : "开始自动巡游"}
      </button>
    </div>
  );
}

function DegreeSlider({
  value,
  max,
  onChange,
  visibleCount,
  total,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  visibleCount: number;
  total: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 76,
        left: 20,
        zIndex: 20,
        background: "oklch(99% 0 0 / 0.92)",
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        width: 240,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: COLOR.textMuted,
          }}
        >
          最少连接边数
        </span>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 12,
            color: COLOR.text,
            fontWeight: 600,
          }}
        >
          ≥ {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: COLOR.accent,
          cursor: "pointer",
        }}
      />
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          color: COLOR.textMuted,
          fontFamily: FONT.mono,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>0</span>
        <span>
          {visibleCount}/{total} 人可见
        </span>
        <span>{max}</span>
      </div>
    </div>
  );
}
