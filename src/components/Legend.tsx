"use client";

/**
 * 折叠图例：右上角 i 图标 → 展开列出 10 类节点（带勾选过滤）+ 5 类边
 *
 * - 类别 checkbox 默认全选，勾选状态变化时通过 onCategoryToggle 通知外层
 *
 * 决策来源：docs/design-freeze.md §5.5 + 后续过滤增量决定
 */
import { useState } from "react";
import type { CharacterCategory } from "@/schemas/character";
import {
  COLOR,
  FONT,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  RELATION_COLOR,
  RELATION_LABEL,
} from "@/lib/tokens";

interface Props {
  enabledCategories: Set<CharacterCategory>;
  onCategoryToggle: (cat: CharacterCategory) => void;
  onCategoriesAll: () => void;
  onCategoriesNone: () => void;
}

export function Legend({
  enabledCategories,
  onCategoryToggle,
  onCategoriesAll,
  onCategoriesNone,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "absolute", top: 16, right: 16, zIndex: 20 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="图例"
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          background: "oklch(99% 0 0 / 0.94)",
          border: `1px solid ${COLOR.border}`,
          color: COLOR.text,
          fontSize: 16,
          fontFamily: FONT.serif,
          cursor: "pointer",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        }}
      >
        {open ? "×" : "ⓘ"}
      </button>
      {open && (
        <div
          style={{
            marginTop: 8,
            width: 300,
            padding: 16,
            background: "oklch(99% 0 0 / 0.98)",
            border: `1px solid ${COLOR.border}`,
            borderRadius: 8,
            color: COLOR.text,
            fontFamily: FONT.sans,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            maxHeight: "70vh",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <Heading>人物类别 · 勾选过滤</Heading>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onCategoriesAll} style={miniBtnStyle}>全选</button>
              <button onClick={onCategoriesNone} style={miniBtnStyle}>清空</button>
            </div>
          </div>
          {(Object.entries(CATEGORY_LABEL) as [CharacterCategory, string][]).map(([k, label]) => {
            const checked = enabledCategories.has(k);
            return (
              <label
                key={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "4px 0",
                  fontSize: 12,
                  cursor: "pointer",
                  userSelect: "none",
                  opacity: checked ? 1 : 0.45,
                  transition: "opacity 120ms",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onCategoryToggle(k)}
                  style={{
                    width: 14,
                    height: 14,
                    accentColor: CATEGORY_COLOR[k],
                    cursor: "pointer",
                  }}
                />
                <Box color={CATEGORY_COLOR[k]} />
                <span>{label}</span>
              </label>
            );
          })}

          <Heading style={{ marginTop: 16 }}>关系边 · 颜色</Heading>
          {Object.entries(RELATION_LABEL).map(([k, label]) => (
            <Row
              key={k}
              swatch={<Line color={RELATION_COLOR[k as keyof typeof RELATION_COLOR]} />}
              label={label}
            />
          ))}

          <Heading style={{ marginTop: 16 }}>边粗细</Heading>
          <div style={{ fontSize: 11, color: COLOR.textMuted, lineHeight: 1.6 }}>
            粗细随两人之间的事件数量递增（1–5px）。事件越多代表两人关系越紧密复杂。
          </div>

          <Heading style={{ marginTop: 16 }}>提示</Heading>
          <div style={{ fontSize: 11, color: COLOR.textMuted, lineHeight: 1.6 }}>
            取消勾选某类别 → 该类节点及其相关的边都会隐藏。两端节点都在已选类别时，边才会显示。
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtnStyle: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: 10,
  fontFamily: FONT.mono,
  letterSpacing: "0.1em",
  background: "transparent",
  border: `1px solid ${COLOR.border}`,
  color: COLOR.textMuted,
  borderRadius: 4,
  cursor: "pointer",
};

function Heading({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: FONT.mono,
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: COLOR.textMuted,
        marginBottom: 8,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Row({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 0", fontSize: 12 }}>
      {swatch}
      <span>{label}</span>
    </div>
  );
}

function Box({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 10,
        border: `2px solid ${color}`,
        borderRadius: 2,
        background: "transparent",
      }}
    />
  );
}

function Line({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 22,
        height: 2,
        background: color,
        borderRadius: 1,
      }}
    />
  );
}
