"use client";

/**
 * 节点卡片 — 精致卡片视觉
 * - 边框颜色 = category 分类
 * - 头像（thumb）+ 名字 + 称号
 * - 决策来源：docs/design-freeze.md §3, §11
 */
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Character } from "@/schemas/character";
import { CATEGORY_COLOR, FONT } from "@/lib/tokens";

export type CharNode = Node<Character, "character">;

export function CharacterNode({ data, selected }: NodeProps<CharNode>) {
  const borderColor = CATEGORY_COLOR[data.category];
  // 入场动画：按 era_layer 错峰淡入，层 0(原始神) → 5(凡人) 依次出现
  const animationDelay = `${data.era_layer * 220}ms`;

  return (
    <div
      style={{
        width: 180,
        height: 110,
        background: "linear-gradient(180deg, oklch(18% 0.014 270) 0%, oklch(13% 0.012 270) 100%)",
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow: selected
          ? `0 0 0 2px ${borderColor}, 0 6px 20px ${borderColor}40`
          : "0 4px 12px rgba(0,0,0,0.4)",
        display: "flex",
        gap: 10,
        padding: 10,
        cursor: "pointer",
        color: "oklch(94% 0 0)",
        fontFamily: FONT.sans,
        transition: "box-shadow 200ms ease",
        animation: `nodeEnter 800ms cubic-bezier(0.16, 1, 0.3, 1) both`,
        animationDelay,
      }}
    >
      <style>{`
        @keyframes nodeEnter {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      {/* 头像 — 缩略图懒加载 */}
      <div
        style={{
          width: 60,
          height: 90,
          borderRadius: 6,
          background: `linear-gradient(135deg, ${borderColor}30 0%, oklch(20% 0.01 270) 100%)`,
          border: `1px solid ${borderColor}60`,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          color: `${borderColor}`,
          fontWeight: 600,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <span style={{ position: "absolute", fontFamily: FONT.serif, fontSize: 26 }}>
          {data.name_zh[0]}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.thumb}
          alt={data.name_zh}
          width={60}
          height={90}
          loading="eager"
          decoding="async"
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: 6,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            fontFamily: FONT.serif,
            letterSpacing: "0.02em",
            lineHeight: 1.2,
          }}
        >
          {data.name_zh}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "oklch(60% 0.01 270)",
            fontFamily: FONT.mono,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {data.name_en}
        </div>
        {data.epithet && (
          <div
            style={{
              fontSize: 11,
              color: borderColor,
              fontStyle: "italic",
              lineHeight: 1.3,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {data.epithet}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}
