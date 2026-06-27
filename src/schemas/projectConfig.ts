/**
 * ProjectConfig — 单个项目的配置契约(projects/<slug>/project.config.json)
 *
 * 与 Python 端 scripts/data/schemas.py 的 ProjectConfig 校验保持一致(同一份 JSON 两侧读)。
 * 颜色/标签/层标签全部在此声明;`artStyle` 仅服务端 + Python 图像管线使用,不下发客户端。
 *
 * 加载期(src/lib/data.ts)用这里的 categories/relationTypes 键集校验数据节点的
 * category / primary_type 是否合法 —— 取代原来 character.ts 里的闭集枚举。
 */
import { z } from "zod";

const Slug = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** 一个分类/关系类型的视觉定义 */
export const Swatch = z.object({
  label: z.string(),
  color: z.string(),
});
export type Swatch = z.infer<typeof Swatch>;

/** 项目完整配置(服务端 / Python 读) */
export const ProjectConfig = z.object({
  schema_version: z.number().int().min(1).max(3),
  slug: Slug,
  title: z.string(),
  subtitle: z.string().nullish(),
  order: z.number().int().default(999),
  draft: z.boolean().default(false),
  /** 中文源优先级:中文题材用 "baike",西方题材用 "wikipedia"(默认)。仅数据管线使用 */
  zhSource: z.enum(["wikipedia", "baike"]).default("wikipedia"),
  characterCategories: z.record(Slug, Swatch),
  artifactCategories: z.record(Slug, Swatch).default({}),
  relationTypes: z.record(Slug, Swatch),
  /** era_layer(int)→ 中文层标签 */
  eraLayers: z.record(z.string(), z.string()).default({}),
  /** 图像管线基础画风(人物 / 器物),仅服务端 + Python 使用 */
  artStyle: z.object({
    character: z.string(),
    artifact: z.string(),
  }),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

/** 客户端子集 —— 去掉 artStyle,随 dataset 走 props 注入 Context */
export const ClientProjectConfig = ProjectConfig.omit({ artStyle: true });
export type ClientProjectConfig = z.infer<typeof ClientProjectConfig>;
