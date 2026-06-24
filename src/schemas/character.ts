/**
 * Character & Relation 数据 schema（前后端契约）
 *
 * 与 Python 端 scripts/data/schemas.py 保持一致。
 * 字段变更必须同时改两侧 + 升 schema_version。
 *
 * 决策来源：docs/design-freeze.md §2.1, §2.2, §2.3, §8
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────
// 节点 10 类分类（决定边框色）
// ─────────────────────────────────────────────────────────────
export const CharacterCategory = z.enum([
  "olympian",          // 奥林匹斯神 — 金白
  "titan",             // 泰坦 — 古铜
  "primordial",        // 原始神/抽象拟人 — 深紫
  "monster",           // 怪物 — 苔绿
  "achaean",           // 阿开亚联军 — 海蓝
  "trojan",            // 特洛伊方 — 砖红
  "argonaut",          // 阿尔戈英雄 — 航蓝
  "independent_hero",  // 独立英雄 — 橄榄金
  "mortal_noncombat",  // 凡人非战角色 — 米灰
  "minor_deity",       // 次要神祇/宁芙 — 薄荷青
]);
export type CharacterCategory = z.infer<typeof CharacterCategory>;

// ─────────────────────────────────────────────────────────────
// 关系 5 类（决定边色）
// ─────────────────────────────────────────────────────────────
export const RelationType = z.enum([
  "blood",       // 血缘 — 暖白
  "marriage",    // 婚姻/情人 — 玫瑰金
  "hostile",     // 敌对 — 暗红
  "ally",        // 同伴/战友 — 青蓝
  "mentor",      // 师徒/庇护 — 橄榄金
]);
export type RelationType = z.infer<typeof RelationType>;

// ─────────────────────────────────────────────────────────────
// 文献出处 — 名言、事件必带
// ─────────────────────────────────────────────────────────────
export const Citation = z.object({
  /** 文献名（如 "Iliad", "Odyssey", "Theogony", "Bibliotheca"） */
  work: z.string(),
  /** 位置（如 "1.234" 表示卷.行，"3.5.2" 表示书.章.节） */
  locus: z.string().nullish(),
  /** 中文译者（如 "罗念生"、"王焕生"），可选 */
  translator: z.string().nullish(),
});
export type Citation = z.infer<typeof Citation>;

// ─────────────────────────────────────────────────────────────
// 名言（仅含古典文献出处的原句）
// ─────────────────────────────────────────────────────────────
export const Quote = z.object({
  /** 中文原句（已译） */
  text: z.string(),
  /** 文献出处 — 必填，保证非幻觉 */
  source: Citation,
});
export type Quote = z.infer<typeof Quote>;

// ─────────────────────────────────────────────────────────────
// 人物事件（出现在详情面板"主要事件"列表）
// ─────────────────────────────────────────────────────────────
export const CharacterEvent = z.object({
  title: z.string(),
  /** 100-200 字描述 */
  desc: z.string(),
  /** 出处可选 — 部分事件源自神话综合，无单一出处 */
  source: Citation.nullish(),
});
export type CharacterEvent = z.infer<typeof CharacterEvent>;

// ─────────────────────────────────────────────────────────────
// Character — 单个人物
// ─────────────────────────────────────────────────────────────
export const Character = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  /** slug, e.g. "zeus", "achilles" — 全局唯一 */
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name_zh: z.string(),
  name_en: z.string(),
  /** 别名（"朱庇特"、"雷霆神"等）— 供搜索匹配 */
  aliases: z.array(z.string()).default([]),
  /** 一句话称号（节点卡片显示，如"众神之王"） */
  epithet: z.string().nullable(),
  /** 决定边框色 */
  category: CharacterCategory,
  /**
   * 代际，决定 dagre 层级位置：
   * 0 = 原始神 (Chaos / Gaia)
   * 1 = 泰坦
   * 2 = 奥林匹斯神
   * 3 = 半神英雄 / 早期英雄
   * 4 = 特洛伊世代英雄 / 凡人
   * 5 = 后世（埃涅阿斯之后）
   * 怪物按其出现年代归层
   */
  era_layer: z.number().int().min(0).max(5),

  // ── 7 字段内容 ──
  /** 生平 100-800 字 */
  bio: z.string().nullable(),
  /** 主要事件 3-20 条 */
  events: z.array(CharacterEvent).default([]),
  /** 名言 0-5 条，全部带出处 */
  quotes: z.array(Quote).default([]),
  /** 武器（如"雷霆"、"三叉戟"） */
  weapons: z.array(z.string()).default([]),
  /** 技能（动词短语，如"投掷雷霆"、"化身天鹅"） */
  skills: z.array(z.string()).default([]),
  /** 神职/领域（名词，如"雷电"、"主权"、"婚姻"） */
  domains: z.array(z.string()).default([]),
  /** 坐骑 */
  mounts: z.array(z.string()).default([]),

  // ── 图像资产路径 ──
  /** 800×1200 半身像，相对 /public */
  portrait: z.string(),
  /** 128×128 头部缩略，相对 /public */
  thumb: z.string(),
});
export type Character = z.infer<typeof Character>;

// ─────────────────────────────────────────────────────────────
// 关系事件（边时间线上的一个事件卡片）
// ─────────────────────────────────────────────────────────────
export const RelationEvent = z.object({
  title: z.string(),
  /** 100-200 字标准描述 */
  desc: z.string(),
  /** 300-500 字展开版（可选） */
  desc_long: z.string().nullish(),
  source: Citation.nullish(),
  /**
   * 神话内时间序号 — 用于时间线排序。
   * 0 = 第一次相遇，递增。无需绝对年代。
   */
  era_order: z.number().int().min(0),
});
export type RelationEvent = z.infer<typeof RelationEvent>;

// ─────────────────────────────────────────────────────────────
// Relation — 一条边
// ─────────────────────────────────────────────────────────────
export const Relation = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  id: z.string(),
  /** source / target = Character.id；图谱上无方向（undirected） */
  source: z.string(),
  target: z.string(),
  /** 主导关系类型 — 决定边色 */
  primary_type: RelationType,
  /** 复合关系（除 primary 之外的额外类型） */
  composite_types: z.array(RelationType).default([]),
  /** 事件链时间线（按 era_order 升序） */
  events: z.array(RelationEvent).default([]),
});
export type Relation = z.infer<typeof Relation>;

// ─────────────────────────────────────────────────────────────
// 数据集容器
// ─────────────────────────────────────────────────────────────
export const Dataset = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  characters: z.array(Character),
  relations: z.array(Relation),
});
export type Dataset = z.infer<typeof Dataset>;

// ─────────────────────────────────────────────────────────────
// 锁定布局坐标
// ─────────────────────────────────────────────────────────────
export const LayoutEntry = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
});
export const Layout = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  positions: z.array(LayoutEntry),
});
export type Layout = z.infer<typeof Layout>;
