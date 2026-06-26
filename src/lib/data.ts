/**
 * 数据加载 —— 多项目版
 *
 * 服务端运行(Server Component / generateStaticParams 阶段)→ 文件系统直读。
 * 客户端运行时通过 props/JSON 传递,不直接 import。
 *
 * 目录约定:projects/<slug>/{project.config.json, data/{characters,artifacts}/*.json, data/relations.json}
 * 图像通过软链 public/p/<slug> → projects/<slug>/images 伺服(见 scripts/link-assets.mjs)。
 */
import fs from "node:fs";
import path from "node:path";
import { Artifact, Character, Relation, Dataset, SCHEMA_VERSION } from "@/schemas/character";
import { ProjectConfig, ClientProjectConfig } from "@/schemas/projectConfig";

const PROJECTS_DIR = path.join(process.cwd(), "projects");

export interface ProjectSummary {
  slug: string;
  title: string;
  subtitle: string | null;
  order: number;
  cover: string | null;
}

export interface LoadedProject {
  dataset: Dataset;
  config: ClientProjectConfig;
}

function projectDir(slug: string): string {
  return path.join(PROJECTS_DIR, slug);
}

/** 扫 projects/*,返回非 draft 项目摘要(用于首页卡片墙 + generateStaticParams) */
export function listProjects(): ProjectSummary[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const slugs = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PROJECTS_DIR, d.name, "project.config.json")))
    .map((d) => d.name);

  const summaries: ProjectSummary[] = [];
  for (const slug of slugs) {
    const config = ProjectConfig.parse(
      JSON.parse(fs.readFileSync(path.join(projectDir(slug), "project.config.json"), "utf-8")),
    );
    if (config.draft) continue;
    const coverExists = fs.existsSync(path.join(projectDir(slug), "images", "cover.webp"));
    summaries.push({
      slug: config.slug,
      title: config.title,
      subtitle: config.subtitle ?? null,
      order: config.order,
      cover: coverExists ? `/p/${slug}/cover.webp` : null,
    });
  }
  return summaries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** 加载单个项目的数据集 + 客户端配置子集 */
export function loadDataset(slug: string): LoadedProject {
  const base = projectDir(slug);
  const configPath = path.join(base, "project.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`项目不存在或缺少 project.config.json: ${slug}`);
  }

  const config = ProjectConfig.parse(JSON.parse(fs.readFileSync(configPath, "utf-8")));

  const characters = loadCharacters(base);
  const artifacts = loadArtifacts(base);
  const relations = loadRelations(base);

  const dataset = Dataset.parse({
    schema_version: SCHEMA_VERSION,
    characters,
    artifacts,
    relations,
  });

  validateAgainstConfig(dataset, config, slug);

  return {
    dataset,
    config: ClientProjectConfig.parse(config),
  };
}

function loadCharacters(base: string): Character[] {
  const dir = path.join(base, "data", "characters");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Character.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))));
}

function loadArtifacts(base: string): Artifact[] {
  const dir = path.join(base, "data", "artifacts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Artifact.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))));
}

function loadRelations(base: string): Relation[] {
  const relPath = path.join(base, "data", "relations.json");
  if (!fs.existsSync(relPath)) return [];
  const raw = JSON.parse(fs.readFileSync(relPath, "utf-8"));
  const arr = Array.isArray(raw) ? raw : (raw.relations ?? []);
  return arr.map((r: unknown) => Relation.parse(r));
}

/** 加载期校验:每个 category / primary_type 必须在项目 config 中声明,否则抛错(取代原闭集枚举) */
function validateAgainstConfig(dataset: Dataset, config: ProjectConfig, slug: string): void {
  const charCats = new Set(Object.keys(config.characterCategories));
  const artCats = new Set(Object.keys(config.artifactCategories));
  const relTypes = new Set(Object.keys(config.relationTypes));
  const errors: string[] = [];

  for (const c of dataset.characters) {
    if (!charCats.has(c.category)) errors.push(`character[${c.id}] 未声明的分类: ${c.category}`);
  }
  for (const a of dataset.artifacts) {
    if (!artCats.has(a.category)) errors.push(`artifact[${a.id}] 未声明的分类: ${a.category}`);
  }
  for (const r of dataset.relations) {
    if (!relTypes.has(r.primary_type)) errors.push(`relation[${r.id}] 未声明的关系类型: ${r.primary_type}`);
    for (const ct of r.composite_types) {
      if (!relTypes.has(ct)) errors.push(`relation[${r.id}] 未声明的复合关系类型: ${ct}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`[${slug}] 数据与 project.config.json 不一致:\n  ${errors.join("\n  ")}`);
  }
}
