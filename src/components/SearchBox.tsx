"use client";

/**
 * 搜索框 — 下拉建议 + 回车过滤平铺
 *
 * 输入预览(query 非空):
 *   - 下拉列表显示最多 8 项命中(name/alias/epithet 优先,然后 fulltext)
 *   - 点击下拉某项 = onPick(id) → 父级走 focus mode
 *   - 底部一行 "共 N 项 · 回车应用" 告知总命中数
 *
 * 回车提交:
 *   - 把所有命中(不止下拉 8 项,而是全部 hit 集)作为过滤集
 *   - onSubmitFilter(query) → 父级走过滤平铺布局
 *
 * 清空: × / ESC / 输入框空 → onClear()
 *
 * ≥2 字严格子串(中文按原样,英文 lowercase 折叠)
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Artifact, Character } from "@/schemas/character";
import { COLOR, FONT } from "@/lib/tokens";
import { useProjectConfig } from "@/lib/projectConfig";

type SearchEntity =
  | { kind: "character"; entity: Character }
  | { kind: "artifact"; entity: Artifact };

const TRIGGER_LEN = 2;
const DROPDOWN_CAP = 8;

interface Hit {
  item: SearchEntity;
  /** 命中来源:name(中/英)/alias/epithet/fulltext */
  origin: "name" | "alias" | "epithet" | "fulltext";
  /** fulltext 命中时的片段 */
  snippet?: string;
}

/**
 * 计算 hit 列表 — 与父级 computeMatchedIds 用同一套规则,但保留 origin 与 snippet。
 */
function computeHits(items: SearchEntity[], rawQuery: string): Hit[] {
  const q = rawQuery.trim();
  if (q.length < TRIGGER_LEN) return [];
  const qLower = q.toLowerCase();

  const nameHits: Hit[] = [];
  const fullHits: Hit[] = [];

  for (const item of items) {
    const e = item.entity;
    // 1) name 优先
    if (e.name_zh.includes(q) || e.name_en.toLowerCase().includes(qLower)) {
      nameHits.push({ item, origin: "name" });
      continue;
    }
    if (e.aliases.some((a) => a.includes(q) || a.toLowerCase().includes(qLower))) {
      nameHits.push({ item, origin: "alias" });
      continue;
    }
    if (e.epithet && e.epithet.includes(q)) {
      nameHits.push({ item, origin: "epithet" });
      continue;
    }

    // 2) fulltext: Character = bio/events/quotes/skills/domains; Artifact = bio/events/domains
    const inBio = e.bio?.includes(q) ?? false;
    const inEvents = e.events.some((ev) => ev.title.includes(q) || ev.desc.includes(q));
    const inDomains = e.domains.some((d) => d.includes(q));
    const inCharacterOnly = item.kind === "character" && (
      item.entity.quotes.some((qu) => qu.text.includes(q)) ||
      item.entity.skills.some((s) => s.includes(q))
    );
    if (inBio || inEvents || inDomains || inCharacterOnly) {
      let snippet = "";
      const search = (text: string | null | undefined) => {
        if (!text) return false;
        const idx = text.indexOf(q);
        if (idx < 0) return false;
        snippet = "…" + text.slice(Math.max(0, idx - 20), idx + q.length + 30) + "…";
        return true;
      };
      if (!search(e.bio)) {
        for (const ev of e.events) if (search(ev.title + " " + ev.desc)) break;
      }
      if (!snippet && item.kind === "character") {
        for (const qu of item.entity.quotes) if (search(qu.text)) break;
      }
      fullHits.push({ item, origin: "fulltext", snippet });
    }
  }

  return [...nameHits, ...fullHits];
}

interface Props {
  items: SearchEntity[];
  /** 当前输入字符串(受控) */
  query: string;
  onQueryChange: (q: string) => void;
  /** 点击下拉某项 — 走 focus mode */
  onPick: (id: string) => void;
  /** 回车 — 整集作为过滤集应用 */
  onSubmitFilter: (query: string) => void;
  /** × 清空(同时清除已应用的过滤) */
  onClear: () => void;
  /** 当前是否已经处于已应用的过滤态(决定 chip 显示) */
  filterApplied: boolean;
  /** 当前已应用的过滤命中数(filterApplied=true 时使用) */
  appliedCount: number;
  /** 数据集总节点数 */
  totalCount: number;
}

export function SearchBox({
  items,
  query,
  onQueryChange,
  onPick,
  onSubmitFilter,
  onClear,
  filterApplied,
  appliedCount,
  totalCount,
}: Props) {
  const { characterCategoryColor, artifactCategoryColor } = useProjectConfig();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => computeHits(items, query), [items, query]);
  const dropdownHits = hits.slice(0, DROPDOWN_CAP);

  const trimmed = query.trim();
  const canSubmit = trimmed.length >= TRIGGER_LEN && hits.length > 0;
  const showDropdown = focused && trimmed.length > 0;

  // 点击外部 = 关闭下拉
  useEffect(() => {
    if (!showDropdown) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showDropdown]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canSubmit) {
        onSubmitFilter(trimmed);
        setFocused(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClear();
      setFocused(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        right: 16,
        maxWidth: 480,
        zIndex: 20,
      }}
    >
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          placeholder="搜索:宙斯 / Zeus / 特洛伊战争 / 十二功业…  (回车应用)"
          style={{
            width: "100%",
            padding: filterApplied ? "10px 180px 10px 14px" : "10px 14px",
            background: "oklch(99% 0 0 / 0.94)",
            border: `1px solid ${filterApplied ? COLOR.accent : COLOR.border}`,
            borderRadius: 8,
            color: COLOR.text,
            fontSize: 14,
            fontFamily: FONT.sans,
            outline: "none",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            transition: "border-color 120ms ease",
          }}
        />

        {/* 已应用 chip — 仅 committed 态显示 */}
        {filterApplied && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              right: 8,
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 6px 3px 10px",
              background: COLOR.accent,
              color: "#fff",
              border: `1px solid ${COLOR.accent}`,
              borderRadius: 999,
              fontSize: 11,
              fontFamily: FONT.mono,
              lineHeight: 1,
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            <span>{appliedCount} / {totalCount} 已应用</span>
            <button
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
              aria-label="清空搜索"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                marginLeft: 2,
                padding: 0,
                background: "transparent",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 输入提示:短查询 */}
      {showDropdown && trimmed.length < TRIGGER_LEN && (
        <div
          style={{
            marginTop: 6,
            padding: "8px 12px",
            background: "oklch(99% 0 0 / 0.96)",
            border: `1px solid ${COLOR.border}`,
            borderRadius: 8,
            color: COLOR.textMuted,
            fontSize: 12,
            fontFamily: FONT.sans,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        >
          至少输入 {TRIGGER_LEN} 个字符
        </div>
      )}

      {/* 下拉建议 */}
      {showDropdown && trimmed.length >= TRIGGER_LEN && (
        <div
          style={{
            marginTop: 6,
            background: "oklch(99% 0 0 / 0.98)",
            border: `1px solid ${COLOR.border}`,
            borderRadius: 8,
            overflow: "hidden",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          {hits.length === 0 ? (
            <div style={{ padding: 12, color: COLOR.textMuted, fontSize: 13 }}>
              无匹配
            </div>
          ) : (
            <>
              {dropdownHits.map((h) => {
                const entity = h.item.entity;
                const color = h.item.kind === "character"
                  ? characterCategoryColor(entity.category)
                  : artifactCategoryColor(entity.category);
                return (
                <button
                  key={entity.id + h.origin}
                  onMouseDown={(e) => {
                    // mousedown 而非 click — 早于 input.onBlur,防止下拉先被收起
                    e.preventDefault();
                    onPick(entity.id);
                    setFocused(false);
                  }}
                  style={{
                    display: "flex",
                    width: "100%",
                    gap: 10,
                    padding: "10px 12px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid ${COLOR.border}`,
                    color: COLOR.text,
                    textAlign: "left",
                    cursor: "pointer",
                    fontFamily: FONT.sans,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 4,
                      background: color,
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontFamily: FONT.serif }}>
                      {entity.name_zh}
                    </span>
                    <span style={{ fontSize: 11, color: COLOR.textMuted, marginLeft: 8, fontFamily: FONT.mono }}>
                      {entity.name_en}
                    </span>
                    {h.item.kind === "artifact" && (
                      <span style={{ fontSize: 10, color, marginLeft: 8, fontFamily: FONT.mono }}>
                        Artifact
                      </span>
                    )}
                    {h.origin === "fulltext" && h.snippet && (
                      <div style={{ fontSize: 11, color: COLOR.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                        {h.snippet}
                      </div>
                    )}
                    {h.origin === "alias" && entity.aliases.length > 0 && (
                      <div style={{ fontSize: 11, color: COLOR.textMuted, marginTop: 2 }}>
                        {entity.aliases.join(" · ")}
                      </div>
                    )}
                  </span>
                  <span style={{ fontSize: 10, color: COLOR.textMuted, fontFamily: FONT.mono, alignSelf: "center" }}>
                    {h.origin}
                  </span>
                </button>
              );
              })}

              {/* 底部提示:总计 N 人 + 回车提交 */}
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (canSubmit) {
                    onSubmitFilter(trimmed);
                    setFocused(false);
                  }
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  background: hits.length > DROPDOWN_CAP ? COLOR.bgPanel : "transparent",
                  border: "none",
                  color: COLOR.textMuted,
                  textAlign: "left",
                  cursor: canSubmit ? "pointer" : "default",
                  fontFamily: FONT.mono,
                  fontSize: 11,
                }}
              >
                <span>
                  共 {hits.length} 项命中
                  {hits.length > DROPDOWN_CAP && ` · 仅显示前 ${DROPDOWN_CAP}`}
                </span>
                <span style={{ color: COLOR.accent }}>↵ 回车应用全部</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
