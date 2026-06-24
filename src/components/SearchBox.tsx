"use client";

/**
 * 搜索框：模糊名 + 别名（B 决策）+ 全文（C 决策）
 *
 * - 默认仅匹配 name_zh / name_en / aliases / epithet（轻量）
 * - 输入后 dynamic import 加载 fuse.js + 全文索引（bio + events 文本）
 * - 命中后回调，由外层负责 fitView 居中 + selectNode
 *
 * 决策来源：docs/design-freeze.md §5.4
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "@/schemas/character";
import { COLOR, FONT, CATEGORY_COLOR } from "@/lib/tokens";

interface Hit {
  character: Character;
  /** 命中来源：name | alias | epithet | fulltext */
  origin: "name" | "alias" | "epithet" | "fulltext";
  /** 全文命中片段（origin === fulltext 时填） */
  snippet?: string;
}

interface FuseResult {
  item: { id: string; text: string };
  score?: number;
}

interface FuseInstance {
  search(q: string): FuseResult[];
}

interface Props {
  characters: Character[];
  onPick: (id: string) => void;
}

export function SearchBox({ characters, onPick }: Props) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [fuse, setFuse] = useState<FuseInstance | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 当输入框首次聚焦：动态加载 fuse + 构建全文索引（推迟 80-150KB）
  useEffect(() => {
    if (!focused || fuse) return;
    let cancelled = false;
    (async () => {
      const FuseMod = (await import("fuse.js")).default;
      const docs = characters.map((c) => ({
        id: c.id,
        text: [
          c.bio ?? "",
          c.events.map((e) => `${e.title} ${e.desc}`).join(" "),
          c.skills.join(" "),
          c.domains.join(" "),
        ].join(" "),
      }));
      const fuseInst = new FuseMod(docs, {
        keys: ["text"],
        includeScore: true,
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }) as unknown as FuseInstance;
      if (!cancelled) setFuse(fuseInst);
    })();
    return () => {
      cancelled = true;
    };
  }, [focused, fuse, characters]);

  const hits: Hit[] = useMemo(() => {
    const query = q.trim();
    if (!query) return [];
    const lowerQ = query.toLowerCase();

    // ── 1) 名 + 别名 + 称号（轻量 substring 匹配）──
    const nameHits: Hit[] = [];
    for (const c of characters) {
      if (c.name_zh.includes(query) || c.name_en.toLowerCase().includes(lowerQ)) {
        nameHits.push({ character: c, origin: "name" });
        continue;
      }
      if (c.aliases.some((a) => a.includes(query) || a.toLowerCase().includes(lowerQ))) {
        nameHits.push({ character: c, origin: "alias" });
        continue;
      }
      if (c.epithet && c.epithet.includes(query)) {
        nameHits.push({ character: c, origin: "epithet" });
      }
    }

    // ── 2) 全文（fuse）─ 排除已经命中的人物
    const seen = new Set(nameHits.map((h) => h.character.id));
    const fullHits: Hit[] = [];
    if (fuse && query.length >= 2) {
      const results = fuse.search(query);
      for (const r of results.slice(0, 6)) {
        const c = characters.find((x) => x.id === r.item.id);
        if (!c || seen.has(c.id)) continue;
        // 简单 snippet：在原文里找 query，截 ±30 字
        const idx = r.item.text.indexOf(query);
        const snippet = idx >= 0
          ? "…" + r.item.text.slice(Math.max(0, idx - 20), idx + query.length + 30) + "…"
          : r.item.text.slice(0, 60) + "…";
        fullHits.push({ character: c, origin: "fulltext", snippet });
      }
    }

    return [...nameHits, ...fullHits].slice(0, 10);
  }, [q, characters, fuse]);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        right: 16,
        maxWidth: 360,
        zIndex: 20,
      }}
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        placeholder="搜索：宙斯 / Zeus / 雷霆神 / 杀蛇…"
        style={{
          width: "100%",
          padding: "10px 14px",
          background: "oklch(99% 0 0 / 0.94)",
          border: `1px solid ${COLOR.border}`,
          borderRadius: 8,
          color: COLOR.text,
          fontSize: 14,
          fontFamily: FONT.sans,
          outline: "none",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        }}
      />
      {q.trim() && (
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
          {hits.length === 0 && (
            <div style={{ padding: 12, color: COLOR.textMuted, fontSize: 13 }}>
              {fuse ? "无匹配" : "加载全文索引中…"}
            </div>
          )}
          {hits.map((h) => (
            <button
              key={h.character.id + h.origin}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(h.character.id);
                setQ("");
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
                  background: CATEGORY_COLOR[h.character.category],
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontFamily: FONT.serif }}>
                  {h.character.name_zh}
                </span>
                <span style={{ fontSize: 11, color: COLOR.textMuted, marginLeft: 8, fontFamily: FONT.mono }}>
                  {h.character.name_en}
                </span>
                {h.origin === "fulltext" && h.snippet && (
                  <div style={{ fontSize: 11, color: COLOR.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                    {h.snippet}
                  </div>
                )}
                {h.origin === "alias" && (
                  <div style={{ fontSize: 11, color: COLOR.textMuted, marginTop: 2 }}>
                    {h.character.aliases.join(" · ")}
                  </div>
                )}
              </span>
              <span style={{ fontSize: 10, color: COLOR.textMuted, fontFamily: FONT.mono, alignSelf: "center" }}>
                {h.origin}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
