"use client";

/**
 * 主页面客户端壳：3D 图谱 + 互斥选择 + 模式切换 + 类别过滤 + 搜索过滤
 */
import { useMemo, useState } from "react";
import type { Artifact, Dataset, Character } from "@/schemas/character";
import type { ClientProjectConfig } from "@/schemas/projectConfig";
import { Graph3D, type LayoutMode } from "./Graph3D";
import { SearchBox } from "./SearchBox";
import { Legend } from "./Legend";
import { ProjectConfigProvider } from "@/lib/projectConfig";
import { COLOR, FONT } from "@/lib/tokens";
import { entityMatchesSearch } from "@/lib/searchMatch";

type Selection =
  | { kind: "none" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

const SEARCH_TRIGGER_LEN = 2;

type SearchEntity = Character | Artifact;

/**
 * 严格子串匹配:与 SearchBox.computeHits 同语义,仅返回 id 集。
 *
 * - <2 字符:返回 null 表示无过滤
 * - 范围:name_zh / name_en / aliases / epithet / bio / events.{title,desc} /
 *   quotes.text / skills / domains
 * - 中文按原样 includes,英文 lowercase 折叠；拼音仅匹配中文 name/alias
 */
function computeMatchedIds(items: SearchEntity[], rawQuery: string): Set<string> | null {
  const q = rawQuery.trim();
  if (q.length < SEARCH_TRIGGER_LEN) return null;
  const matched = new Set<string>();
  for (const item of items) {
    if (entityMatchesSearch(item, q)) {
      matched.add(item.id);
    }
  }
  return matched;
}

export function GraphShell({ dataset, config }: { dataset: Dataset; config: ClientProjectConfig }) {
  const allCategoryKeys = useMemo(() => Object.keys(config.characterCategories), [config]);
  const allArtifactCategoryKeys = useMemo(() => Object.keys(config.artifactCategories), [config]);

  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("tier");
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(
    () => new Set(allCategoryKeys),
  );
  const [enabledArtifactCategories, setEnabledArtifactCategories] = useState<Set<string>>(
    () => new Set(allArtifactCategoryKeys),
  );
  const [minDegree, setMinDegree] = useState<number>(0);
  // 加载即进入巡游模式
  const [autoTour, setAutoTour] = useState<boolean>(true);

  // 搜索:draft = 输入中,committed = 已回车应用的 query
  // committed !== "" 时,Graph3D 进入"过滤平铺"态(filterMode)
  const [draftQuery, setDraftQuery] = useState<string>("");
  const [committedQuery, setCommittedQuery] = useState<string>("");

  const searchItems = useMemo(
    () => [
      ...dataset.characters.map((entity) => ({ kind: "character" as const, entity })),
      ...dataset.artifacts.map((entity) => ({ kind: "artifact" as const, entity })),
    ],
    [dataset.characters, dataset.artifacts],
  );

  // 已应用的命中集 — 仅由 committedQuery 计算,驱动 3D 过滤平铺
  const matchedIds = useMemo(
    () => computeMatchedIds([...dataset.characters, ...dataset.artifacts], committedQuery),
    [dataset.characters, dataset.artifacts, committedQuery],
  );

  const handleSearchChange = (q: string) => {
    setDraftQuery(q);
    // 输入与已 commit 不一致 → 撤销 commit(让"修改输入"自动回到全图,避免错位)
    if (q.trim() !== committedQuery.trim()) {
      setCommittedQuery("");
    }
  };
  const handleSearchSubmit = (q: string) => {
    setCommittedQuery(q);
    // 进入过滤平铺态 — 退出 focus mode、关闭已选
    setFocusedId(null);
    setSel({ kind: "none" });
  };
  const handleSearchClear = () => {
    setDraftQuery("");
    setCommittedQuery("");
  };
  // 下拉选某项 = 进入单焦点(focus mode)
  const handleSearchPick = (id: string) => {
    setDraftQuery("");
    setCommittedQuery("");
    setSel({ kind: "node", id });
    setFocusId(id);
    setFocusedId(id);
  };

  // 计算每个节点的度数 + 最大度数（用于滑动条上限）
  const degreeInfo = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of dataset.characters) m.set(c.id, 0);
    for (const a of dataset.artifacts) m.set(a.id, 0);
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
  const artifact = sel.kind === "node"
    ? dataset.artifacts.find((a) => a.id === sel.id)
    : null;
  const nodeById = useMemo(
    () => new Map([...dataset.characters, ...dataset.artifacts].map((n) => [n.id, n])),
    [dataset.characters, dataset.artifacts],
  );
  const relation = sel.kind === "edge"
    ? dataset.relations.find((r) => r.id === sel.id)
    : null;
  const relChars = relation
    ? {
        source: nodeById.get(relation.source),
        target: nodeById.get(relation.target),
      }
    : null;

  // 节点点击：
  //   - 过滤平铺态:仅打开右侧详情面板,不进入 focus mode(保留多分量展示)
  //   - 普通态:首次=进入聚焦+打开详情；再次点同一节点=退出聚焦+关闭详情
  const handleNodeClick = (id: string) => {
    if (matchedIds) {
      // 过滤平铺态
      setSel({ kind: "node", id });
      return;
    }
    if (focusedId === id) {
      setFocusedId(null);
      setSel({ kind: "none" });
    } else {
      setFocusedId(id);
      setSel({ kind: "node", id });
    }
  };

  // 点击空白:
  //   - 过滤态下仅关闭详情(保留过滤)
  //   - 普通态:退出聚焦+关闭一切
  const handleBackground = () => {
    if (!matchedIds) setFocusedId(null);
    setSel({ kind: "none" });
  };

  // 点击边：仅选中，不影响聚焦态
  const handleEdgeClick = (id: string) => setSel({ kind: "edge", id });

  // 类别勾选
  const toggleCategory = (cat: string) => {
    setEnabledCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const allCategories = () => setEnabledCategories(new Set(allCategoryKeys));
  const noCategories = () => setEnabledCategories(new Set());

  const toggleArtifactCategory = (cat: string) => {
    setEnabledArtifactCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };
  const allArtifactCategories = () => setEnabledArtifactCategories(new Set(allArtifactCategoryKeys));
  const noArtifactCategories = () => setEnabledArtifactCategories(new Set());

  // 缓存 set 给 Graph3D 用，避免每次 render 都重建依赖
  const enabledSet = useMemo(() => enabledCategories, [enabledCategories]);
  const enabledArtifactSet = useMemo(() => enabledArtifactCategories, [enabledArtifactCategories]);

  return (
    <ProjectConfigProvider config={config}>
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
      <div style={{ borderRight: `1px solid ${COLOR.border}`, position: "relative" }}>
        <SearchBox
          items={searchItems}
          query={draftQuery}
          onQueryChange={handleSearchChange}
          onPick={handleSearchPick}
          onSubmitFilter={handleSearchSubmit}
          onClear={handleSearchClear}
          filterApplied={matchedIds !== null}
          appliedCount={matchedIds?.size ?? 0}
          totalCount={dataset.characters.length + dataset.artifacts.length}
        />
        <Legend
          enabledCategories={enabledSet}
          enabledArtifactCategories={enabledArtifactSet}
          onCategoryToggle={toggleCategory}
          onCategoriesAll={allCategories}
          onCategoriesNone={noCategories}
          onArtifactCategoryToggle={toggleArtifactCategory}
          onArtifactCategoriesAll={allArtifactCategories}
          onArtifactCategoriesNone={noArtifactCategories}
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
          total={dataset.characters.length + dataset.artifacts.length}
        />
        <Graph3D
          dataset={dataset}
          layoutMode={layoutMode}
          selectedNodeId={sel.kind === "node" ? sel.id : null}
          selectedEdgeId={sel.kind === "edge" ? sel.id : null}
          focusedId={focusedId}
          focusNodeId={focusId}
          enabledCategories={enabledSet}
          enabledArtifactCategories={enabledArtifactSet}
          minDegree={minDegree}
          matchedIds={matchedIds}
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
              {config.title}
            </div>
            {config.subtitle && <>{config.subtitle}<br /></>}
            点击节点查看详情，点击边查看二者之间的事件链。
            <div style={{ marginTop: 16, fontSize: 12 }}>
              · 鼠标拖动：旋转视角<br />
              · 滚轮：缩放<br />
              · 拖动节点：移动节点位置<br />
              · 左下角：切换分层 / 自由布局
            </div>
            <div style={{ marginTop: 24, fontSize: 12 }}>
              数据：{dataset.characters.length} 人 · {dataset.artifacts.length} 件神器 · {dataset.relations.length} 条关系
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

        {artifact && (
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
                src={artifact.portrait}
                alt={artifact.name_zh}
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
            </div>

            <div style={{ fontFamily: FONT.serif, fontSize: 28, fontWeight: 600 }}>
              {artifact.name_zh}
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: 11, color: COLOR.textMuted, letterSpacing: "0.1em" }}>
              {artifact.name_en} · {artifact.category.toUpperCase()}
            </div>

            {artifact.epithet && (
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
                {artifact.epithet}
              </div>
            )}

            <Section
              title="拥有/使用者"
              items={dataset.relations
                .filter((r) => r.target === artifact.id)
                .map((r) => dataset.characters.find((c) => c.id === r.source))
                .filter((owner): owner is Character => Boolean(owner))
                .map((owner) => (
                  <button
                    key={owner.id}
                    onClick={() => {
                      setSel({ kind: "node", id: owner.id });
                      setFocusId(owner.id);
                      setFocusedId(owner.id);
                    }}
                    style={{
                      display: "inline-block",
                      margin: "0 8px 8px 0",
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${COLOR.border}`,
                      background: COLOR.bgRaised,
                      color: COLOR.text,
                      fontFamily: FONT.sans,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {owner.name_zh}
                  </button>
                ))}
            />

            <KVRow label="象征/领域" values={artifact.domains} />

            {artifact.bio && (
              <Section
                title="宝物简介"
                items={<p style={{ lineHeight: 1.75, fontSize: 14, margin: 0 }}>{artifact.bio}</p>}
              />
            )}

            <Section
              title="关键事件"
              items={artifact.events.map((e) => (
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
    </ProjectConfigProvider>
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
          {visibleCount}/{total} 节点可见
        </span>
        <span>{max}</span>
      </div>
    </div>
  );
}
