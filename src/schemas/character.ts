/**
 * Character / Relation / Artifact 数据 schema(前后端契约)
 *
 * 与 Python 端 scripts/data/schemas.py 保持一致。
 * 字段变更必须同时改两侧 + 升 schema_version。
 *
 * 决策来源:docs/design-freeze.md §2.1, §2.2, §2.3, §8 + 后续 Artifact 扩展
 */
import { z } from "zod";

/** 当前 schema 版本 — v2 引入 Artifact;v3 引入正典标注 canon。兼容 1/2/3。 */
export const SCHEMA_VERSION = 3;

/** 历史数据(SCHEMA_VERSION=1/2)与新数据(=3)均接受 */
const SchemaVersionField = z.number().int().min(1).max(3);

// ─────────────────────────────────────────────────────────────
// 分类 / 关系类型 — 通用化(项目无关)
//
// 具体取值由各项目 projects/<slug>/project.config.json 定义:
//   - characterCategories / artifactCategories / relationTypes
// schema 本身只校验 slug 格式;某取值是否「合法」改由加载期校验
// (src/lib/data.ts 与 scripts/data/schemas.py 按当前项目 config 的键集判定,
//  未声明的分类 / 关系类型 → 直接报错,等价于原闭集枚举的防错能力)。
// ─────────────────────────────────────────────────────────────
const Slug = z.string().regex(/^[a-z][a-z0-9_]*$/);

// ─────────────────────────────────────────────────────────────
// 正典归属(v3)— 多正典题材(如三国:演义/正史)用于区分事件来源
//   romance = 演义/小说独有  history = 正史可考  both = 两者皆载
//   null/缺省 = 不适用(单一正典题材如希腊神话)
// ─────────────────────────────────────────────────────────────
export const Canon = z.enum(["romance", "history", "both"]);
export type Canon = z.infer<typeof Canon>;

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
  canon: Canon.nullish(),
});
export type Quote = z.infer<typeof Quote>;

// ─────────────────────────────────────────────────────────────
// 事件(用于 Character 与 Artifact)
// ─────────────────────────────────────────────────────────────
export const CharacterEvent = z.object({
  title: z.string(),
  desc: z.string(),
  source: Citation.nullish(),
  canon: Canon.nullish(),
});
export type CharacterEvent = z.infer<typeof CharacterEvent>;

// ─────────────────────────────────────────────────────────────
// Character — 人物
// ─────────────────────────────────────────────────────────────
export const Character = z.object({
  schema_version: SchemaVersionField,
  id: Slug,
  name_zh: z.string(),
  name_en: z.string(),
  aliases: z.array(z.string()).default([]),
  epithet: z.string().nullable(),
  category: Slug,
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
  id: Slug,
  name_zh: z.string(),
  name_en: z.string(),
  aliases: z.array(z.string()).default([]),
  /** 一句话定义(节点卡片显示,如"宙斯的不可抵御武器") */
  epithet: z.string().nullable(),
  /** weapon | treasure 等,具体取值见项目 config.artifactCategories */
  category: Slug,

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
  canon: Canon.nullish(),
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
  primary_type: Slug,
  composite_types: z.array(Slug).default([]),
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
