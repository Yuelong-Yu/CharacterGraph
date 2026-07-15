"use client";

/**
 * 折叠图例：右上角 i 图标 → 展开列出人物类别 + Artifact 类别 + 关系边
 *
 * - 人物类别 checkbox 默认全选
 * - Artifact 类别 checkbox 默认全选
 * - 边只展示颜色说明
 */
import { useState } from "react";
import { COLOR, FONT } from "@/lib/tokens";
import { useProjectConfig } from "@/lib/projectConfig";

interface Props {
  enabledCategories: Set<string>;
  enabledArtifactCategories: Set<string>;
  onCategoryToggle: (cat: string) => void;
  onCategoriesAll: () => void;
  onCategoriesNone: () => void;
  onArtifactCategoryToggle: (cat: string) => void;
  onArtifactCategoriesAll: () => void;
  onArtifactCategoriesNone: () => void;
}

export function Legend({
  enabledCategories,
  enabledArtifactCategories,
  onCategoryToggle,
  onCategoriesAll,
  onCategoriesNone,
  onArtifactCategoryToggle,
  onArtifactCategoriesAll,
  onArtifactCategoriesNone,
}: Props) {
  const { config } = useProjectConfig();
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
            width: 320,
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
          {Object.entries(config.characterCategories).map(([k, { label, color }]) => {
            const checked = enabledCategories.has(k);
            return (
              <label key={k} style={rowLabelStyle(checked)}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onCategoryToggle(k)}
                  style={{ width: 14, height: 14, accentColor: color, cursor: "pointer" }}
                />
                <Box color={color} />
                <span>{label}</span>
              </label>
            );
          })}

          <div style={{ marginTop: 8 }}>
            <Row swatch={<Box color="#d92d20" />} label="用户新增人物" />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16, marginBottom: 8 }}>
            <Heading>神器类别 · 勾选过滤</Heading>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onArtifactCategoriesAll} style={miniBtnStyle}>全选</button>
              <button onClick={onArtifactCategoriesNone} style={miniBtnStyle}>清空</button>
            </div>
          </div>
          {Object.entries(config.artifactCategories).map(([k, { label, color }]) => {
            const checked = enabledArtifactCategories.has(k);
            return (
              <label key={k} style={rowLabelStyle(checked)}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onArtifactCategoryToggle(k)}
                  style={{ width: 14, height: 14, accentColor: color, cursor: "pointer" }}
                />
                <Box color={color} />
                <span>{label}</span>
              </label>
            );
          })}

          <Heading style={{ marginTop: 16 }}>关系边 · 颜色</Heading>
          {Object.entries(config.relationTypes).map(([k, { label, color }]) => (
            <Row key={k} swatch={<Line color={color} />} label={label} />
          ))}

          <Heading style={{ marginTop: 16 }}>边粗细</Heading>
          <div style={{ fontSize: 11, color: COLOR.textMuted, lineHeight: 1.6 }}>
            粗细随两端节点之间的事件数量递增（1–5px）。事件越多代表关系越紧密复杂。
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

function rowLabelStyle(checked: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "4px 0",
    fontSize: 12,
    cursor: "pointer",
    userSelect: "none",
    opacity: checked ? 1 : 0.45,
    transition: "opacity 120ms",
  };
}

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
