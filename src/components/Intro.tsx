"use client";

/**
 * 代际入场动画 + 教学
 *
 * - 首次访问：全屏 overlay 分阶段显示 4-5 帧文字 + 教学 3 个核心编码
 * - 回访（localStorage 有标记）：自动跳过，直接显示图谱
 * - 任何时候按 ESC 或点击"跳过"立即结束
 * - 同时下层图谱的节点用 CSS keyframes 按 era_layer 错峰淡入（节点本身）
 *
 * 决策来源：docs/design-freeze.md §5.1, §5.5 (E 入场+教学)
 */
import { useEffect, useState, useCallback } from "react";
import { COLOR, FONT } from "@/lib/tokens";

const STORAGE_KEY = "greekmyths_intro_seen_v1";

const FRAMES: { title: string; subtitle?: string; ms: number }[] = [
  {
    title: "Ἐν ἀρχῇ",
    subtitle: "起初，是混沌。",
    ms: 1400,
  },
  {
    title: "代际涌现",
    subtitle: "从盖亚到奥林匹斯，从泰坦到英雄——人物按时代分层排列。",
    ms: 1700,
  },
  {
    title: "节点边框 · 人物类别",
    subtitle: "金白=奥林匹斯神 · 古铜=泰坦 · 深紫=原始神 · 苔绿=怪物 · 海蓝/砖红=阿开亚/特洛伊 · 橄榄金=独立英雄",
    ms: 2000,
  },
  {
    title: "关系边 · 五种联结",
    subtitle: "白=血缘 · 玫瑰金=婚姻 · 暗红=敌对 · 青蓝=同伴 · 橄榄=师徒。粗细 = 事件数。",
    ms: 1900,
  },
  {
    title: "现在，开始探索。",
    subtitle: "点击节点查看人物 · 点击边查看二人之间的事件链",
    ms: 1200,
  },
];

export function Intro({ onDone }: { onDone?: () => void }) {
  const [phase, setPhase] = useState<"checking" | "playing" | "done">("checking");
  const [frameIdx, setFrameIdx] = useState(0);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setPhase("done");
    onDone?.();
  }, [onDone]);

  // 检查是否首次访问
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // ignore
    }
    if (seen) {
      setPhase("done");
      onDone?.();
    } else {
      setPhase("playing");
    }
  }, [onDone]);

  // 帧推进
  useEffect(() => {
    if (phase !== "playing") return;
    if (frameIdx >= FRAMES.length) {
      finish();
      return;
    }
    const t = setTimeout(() => setFrameIdx((i) => i + 1), FRAMES[frameIdx].ms);
    return () => clearTimeout(t);
  }, [phase, frameIdx, finish]);

  // ESC 跳过
  useEffect(() => {
    if (phase !== "playing") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, finish]);

  if (phase !== "playing") return null;

  const frame = FRAMES[Math.min(frameIdx, FRAMES.length - 1)];
  const progress = (frameIdx + 1) / FRAMES.length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "radial-gradient(ellipse at center, oklch(99% 0 0 / 0.98) 0%, oklch(96% 0.003 270 / 0.99) 80%)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLOR.text,
        cursor: "pointer",
      }}
      onClick={finish}
    >
      <div style={{ maxWidth: 720, padding: 40, textAlign: "center" }}>
        <div
          key={`title-${frameIdx}`}
          style={{
            fontFamily: FONT.serif,
            fontSize: 48,
            fontWeight: 500,
            letterSpacing: "0.02em",
            animation: "fadeUp 700ms ease-out",
          }}
        >
          {frame.title}
        </div>
        {frame.subtitle && (
          <div
            key={`sub-${frameIdx}`}
            style={{
              marginTop: 24,
              fontSize: 15,
              lineHeight: 1.8,
              color: COLOR.textMuted,
              fontFamily: FONT.sans,
              animation: "fadeUp 700ms ease-out 200ms backwards",
            }}
          >
            {frame.subtitle}
          </div>
        )}
      </div>

      {/* 跳过按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        style={{
          position: "absolute",
          bottom: 32,
          right: 32,
          padding: "8px 16px",
          background: "transparent",
          border: `1px solid ${COLOR.border}`,
          borderRadius: 6,
          color: COLOR.textMuted,
          fontSize: 12,
          fontFamily: FONT.mono,
          letterSpacing: "0.1em",
          cursor: "pointer",
        }}
      >
        SKIP · ESC
      </button>

      {/* 进度条 */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 2,
          width: `${progress * 100}%`,
          background: COLOR.accent,
          transition: "width 400ms ease-out",
        }}
      />

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
