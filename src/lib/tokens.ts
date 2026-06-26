/**
 * 设计令牌(design tokens)— 浅色主题(白底 + 3D 图谱)中与项目无关的通用部分。
 *
 * 项目专属的分类/关系「颜色 + 标签」已移出本文件,改由各项目
 * projects/<slug>/project.config.json 定义,经 src/lib/projectConfig.tsx 的
 * Context 注入组件(useProjectConfig)。本文件只保留跨项目通用的底色与字体。
 *
 * 注意:three.js 不识别 oklch,凡进入 3D 场景的颜色必须是 hex。
 */

// ─── 基础调色(白底主题,跨项目通用)───────────────────────────
export const COLOR = {
  bg: "#fdfdfd",              // 接近纯白
  bgRaised: "#f5f5f7",        // 面板/卡片背景
  bgPanel: "#f3f3f5",         // 右侧详情面板
  border: "#dadadc",
  text: "#1d1d20",            // 主文字
  textMuted: "#6e6e74",       // 辅助文字
  accent: "#b03a2e",          // 暗红古典 accent — 选中/高亮
} as const;

// ─── 字体 ─────────────────────────────────────────────────
export const FONT = {
  serif: '"Cormorant Garamond", "Source Han Serif SC", "Songti SC", serif',
  sans: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
} as const;
