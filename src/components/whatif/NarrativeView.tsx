"use client";

/**
 * 叙事展示组件
 *
 * - 流式态（segments === null）：显示原始 streamText，逐字涌现
 * - 完成态（segments !== null）：按标签着色段列表
 *   - 【原典】灰
 *   - 【假设】青
 *   - 【推演】蓝
 *   - 【杜撰】橙
 */
import type { NarrativeLabel, NarrativeSegment } from "@/schemas/whatif";
import { extractStreamingNarrative } from "@/lib/whatif/streamingNarrative";

const LABEL_COLORS: Record<NarrativeLabel, string> = {
  原典: "#888",
  假设: "#25a69a",
  推演: "#4a9eff",
  杜撰: "#ff8c00",
};

interface Props {
  streamText: string;
  segments: NarrativeSegment[] | null;
}

export function NarrativeView({ streamText, segments }: Props) {
  if (segments) {
    return (
      <div>
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 12,
              paddingLeft: 12,
              borderLeft: `3px solid ${LABEL_COLORS[seg.label]}`,
            }}
          >
            <span
              style={{
                color: LABEL_COLORS[seg.label],
                fontWeight: 600,
                marginRight: 8,
                fontSize: 13,
              }}
            >
              【{seg.label}】
            </span>
            <span className="whatif-narrative-text" style={{ fontSize: 16, lineHeight: 1.75 }}>{seg.text}</span>
          </div>
        ))}
      </div>
    );
  }

  // 流式态：只显示面向用户的叙事正文，隐藏 DIFF、分隔符和选项等结构化中间结果。
  const visibleNarrative = extractStreamingNarrative(streamText);
  if (!visibleNarrative) return null;

  return (
    <div
      className="whatif-narrative-text"
      style={{
        whiteSpace: "pre-wrap",
        fontSize: 16,
        lineHeight: 1.75,
        color: "#aaa",
      }}
    >
      {visibleNarrative}
      <span style={{ animation: "blink 1s steps(2) infinite" }}>▌</span>
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
    </div>
  );
}
