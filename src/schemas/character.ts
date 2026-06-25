/**
 * Character / Relation / Artifact 数据 schema(前后端契约)
 *
 * 与 Python 端 scripts/data/schemas.py 保持一致。
 * 字段变更必须同时改两侧 + 升 schema_version。
 *
 * 决策来源:docs/design-freeze.md §2.1, §2.2, §2.3, §8 + 后续 Artifact 扩展
 */
import { z } from "zod";

/** 当前 schema 版本 — Artifact 引入后升到 2;Character/Relation 继续兼容 1/2。 */
export const SCHEMA_VERSION = 2;

/** 历史数据(SCHEMA_VERSION=1)与新数据(=2)均接受 */
const SchemaVersionField = z.number().int().min(1).max(2);

// ─────────────────────────────────────────────────────────────
// Character 节点 10 类分类(决定边框色)
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
// Artifact 节点 2 类(决定边框色)
// ─────────────────────────────────────────────────────────────
export const ArtifactCategory = z.enum([
  "weapon",    // 武器(三叉戟/闪电/镰刀/弓...)— 深红
  "treasure",  // 宝物(金苹果/金羊毛/隐形头盔/木马/盒子...)— 金黄
]);
export type ArtifactCategory = z.infer<typeof ArtifactCategory>;

// ─────────────────────────────────────────────────────────────
// 关系类型(决定边色)— 6 类
// ─────────────────────────────────────────────────────────────
export const RelationType = z.enum([
  "blood",       // 血缘 — 暖白
  "marriage",    // 婚姻/情人 — 玫瑰金
  "hostile",     // 敌对 — 暗红
  "ally",        // 同伴/战友 — 青蓝
  "mentor",      // 师徒/庇护 — 橄榄金
  "owns",        // 拥有/使用(Character → Artifact)— 青碧
]);
export type RelationType = z.infer<typeof RelationType>;

// ─────────────────────────────────────────────────────────────
// 文献出处 — 名言、事件必带
// ─────────────────────────────────────────────────────────────
export const Citation = z.object({
  work: z.string(),
  locus: z.string().nullish(),
  translator: z.string().nullish(),
});
export type Citation = z.infer<typeof Citation>;

// ─────────────────────────────────────────────────────────────
// 名言
// ─────────────────────────────────────────────────────────────
export const Quote = z.object({
  text: z.string(),
  source: Citation,
});
export type Quote = z.infer<typeof Quote>;

// ─────────────────────────────────────────────────────────────
// 事件(用于 Character 与 Artifact)
// ─────────────────────────────────────────────────────────────
export const CharacterEvent = z.object({
  title: z.string(),
  desc: z.string(),
  source: Citation.nullish(),
});
export type CharacterEvent = z.infer<typeof CharacterEvent>;

// ─────────────────────────────────────────────────────────────
// Character — 人物
// ─────────────────────────────────────────────────────────────
export const Character = z.object({
  schema_version: SchemaVersionField,
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name_zh: z.string(),
  name_en: z.string(),
  aliases: z.array(z.string()).default([]),
  epithet: z.string().nullable(),
  category: CharacterCategory,
  era_layer: z.number().int().min(0).max(5),

  bio: z.string().nullable(),
  events: z.array(CharacterEvent).default([]),
  quotes: z.array(Quote).default([]),
  weapons: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  mounts: z.array(z.string()).default([]),

  portrait: z.string(),
  thumb: z.string(),
});
export type Character = z.infer<typeof Character>;

// ─────────────────────────────────────────────────────────────
// Artifact — 武器/宝物
// 与 Character 字段对照精简:无 quotes/skills/weapons/mounts/era_layer
// ─────────────────────────────────────────────────────────────
export const Artifact = z.object({
  schema_version: SchemaVersionField,
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name_zh: z.string(),
  name_en: z.string(),
  aliases: z.array(z.string()).default([]),
  /** 一句话定义(节点卡片显示,如"宙斯的不可抵御武器") */
  epithet: z.string().nullable(),
  /** weapon | treasure */
  category: ArtifactCategory,

  /** 200-600 字背景(由来 / 形态 / 神力 / 流转) */
  bio: z.string().nullable(),
  /** 关键事件 1-6 条,均带文献出处 */
  events: z.array(CharacterEvent).default([]),
  /** 象征/职能(名词,如"主权""丰饶""不死") */
  domains: z.array(z.string()).default([]),

  portrait: z.string(),
  thumb: z.string(),
});
export type Artifact = z.infer<typeof Artifact>;

// ─────────────────────────────────────────────────────────────
// 关系事件
// ─────────────────────────────────────────────────────────────
export const RelationEvent = z.object({
  title: z.string(),
  desc: z.string(),
  desc_long: z.string().nullish(),
  source: Citation.nullish(),
  era_order: z.number().int().min(0),
});
export type RelationEvent = z.infer<typeof RelationEvent>;

// ─────────────────────────────────────────────────────────────
// Relation — 边(Character-Character 或 Character-Artifact)
// ─────────────────────────────────────────────────────────────
export const Relation = z.object({
  schema_version: SchemaVersionField,
  id: z.string(),
  /** source/target = Character.id 或 Artifact.id;OWNS 时 source=character, target=artifact */
  source: z.string(),
  target: z.string(),
  primary_type: RelationType,
  composite_types: z.array(RelationType).default([]),
  events: z.array(RelationEvent).default([]),
});
export type Relation = z.infer<typeof Relation>;

// ─────────────────────────────────────────────────────────────
// 数据集容器
// ─────────────────────────────────────────────────────────────
export const Dataset = z.object({
  schema_version: SchemaVersionField,
  characters: z.array(Character),
  /** Artifact 列表,可空(老数据兼容) */
  artifacts: z.array(Artifact).default([]),
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
  schema_version: SchemaVersionField,
  positions: z.array(LayoutEntry),
});
export type Layout = z.infer<typeof Layout>;
