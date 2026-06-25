/**
 * 设计令牌（design tokens）— 浅色主题（白底 + 3D 图谱）
 *
 * 注意：之前的深色 Dota 主题已废弃。
 * - 节点 10 类色：必须在白底上对比度足够（亮度 ≤ 65%）
 * - 关系 5 类边色：在白底上也要可见，避免太浅
 *
 * 决策来源：docs/design-freeze.md §2.2 / §2.3 + 用户后续白底 + 3D 决定
 */
import type { ArtifactCategory, CharacterCategory, RelationType } from "@/schemas/character";

// ─── 基础调色（白底主题）───────────────────────────────────
export const COLOR = {
  bg: "#fdfdfd",              // 接近纯白
  bgRaised: "#f5f5f7",        // 面板/卡片背景
  bgPanel: "#f3f3f5",         // 右侧详情面板
  border: "#dadadc",
  text: "#1d1d20",            // 主文字
  textMuted: "#6e6e74",       // 辅助文字
  accent: "#b03a2e",          // 暗红古典 accent — 选中/高亮
} as const;

// ─── 10 类节点边框色（白底校准，hex — three.js 不识别 oklch）─────
export const CATEGORY_COLOR: Record<CharacterCategory, string> = {
  olympian:         "#b88a2c",   // 深金 — 神圣
  titan:            "#9a6a2e",   // 深古铜 — 远古
  primordial:       "#6f3da8",   // 深紫 — 混沌
  monster:          "#3f7a4a",   // 深苔绿 — 异兽
  achaean:          "#2e6cb8",   // 海蓝 — 爱琴海
  trojan:           "#b03a2e",   // 砖红 — 小亚细亚
  argonaut:         "#3a4ec2",   // 航蓝 — 出海
  independent_hero: "#8b8230",   // 橄榄绿金 — 典范
  mortal_noncombat: "#7c7672",   // 中灰 — 凡俗
  minor_deity:      "#3da095",   // 深青绿 — 精灵
};

export const CATEGORY_LABEL: Record<CharacterCategory, string> = {
  olympian:         "奥林匹斯神",
  titan:            "泰坦",
  primordial:       "原始神",
  monster:          "怪物",
  achaean:          "阿开亚联军",
  trojan:           "特洛伊方",
  argonaut:         "阿尔戈英雄",
  independent_hero: "独立英雄",
  mortal_noncombat: "凡人非战角色",
  minor_deity:      "次要神祇/宁芙",
};

// ─── Artifact 2 类节点边框色(白底校准,hex)─────
export const ARTIFACT_CATEGORY_COLOR: Record<ArtifactCategory, string> = {
  weapon:   "#7a1f1a",   // 深酒红 — 兵刃肃杀
  treasure: "#c08b1c",   // 古金 — 宝物
};

export const ARTIFACT_CATEGORY_LABEL: Record<ArtifactCategory, string> = {
  weapon:   "武器",
  treasure: "宝物",
};

// ─── 6 类关系边色(白底校准,hex)──────────────────────
export const RELATION_COLOR: Record<RelationType, string> = {
  blood:    "#8a8580",   // 中性灰 — 血缘,最常见所以低调
  marriage: "#c0506e",   // 玫瑰红 — 婚姻
  hostile:  "#b8332b",   // 暗红 — 敌对
  ally:     "#2e6cb8",   // 蓝 — 同伴
  mentor:   "#8b8230",   // 橄榄金 — 师徒
  owns:     "#1f8a7a",   // 青碧 — 拥有(Character → Artifact)
};

export const RELATION_LABEL: Record<RelationType, string> = {
  blood:    "血缘",
  marriage: "婚姻/情人",
  hostile:  "敌对",
  ally:     "同伴/战友",
  mentor:   "师徒/庇护",
  owns:     "拥有/使用",
};

// ─── 字体 ─────────────────────────────────────────────────
export const FONT = {
  serif: '"Cormorant Garamond", "Source Han Serif SC", "Songti SC", serif',
  sans: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
} as const;
