"use client";

/**
 * ProjectConfigContext — 把当前项目的客户端配置(色/标签/层标签)注入组件树。
 *
 * 由 GraphShell 在顶层注入;Graph3D / Legend / SearchBox 通过 useProjectConfig()
 * 读取分类/关系的颜色与标签,取代原来写死在 tokens.ts 的 CATEGORY_COLOR 等映射。
 */
import { createContext, useContext, useMemo } from "react";
import type { ClientProjectConfig, Swatch } from "@/schemas/projectConfig";

/** 未知 key 的兜底色(数据与 config 不一致时,加载期已会报错,这里仅防御性兜底) */
const FALLBACK_COLOR = "#9a9aa0";

export interface ProjectConfigValue {
  config: ClientProjectConfig;
  characterCategoryColor: (cat: string) => string;
  characterCategoryLabel: (cat: string) => string;
  artifactCategoryColor: (cat: string) => string;
  artifactCategoryLabel: (cat: string) => string;
  relationColor: (type: string) => string;
  relationLabel: (type: string) => string;
  eraLabel: (era: number) => string;
}

const Ctx = createContext<ProjectConfigValue | null>(null);

function pick(map: Record<string, Swatch>, key: string, field: "color" | "label", fallback: string): string {
  const entry = map[key];
  if (!entry) return field === "color" ? FALLBACK_COLOR : fallback;
  return entry[field];
}

export function ProjectConfigProvider({
  config,
  children,
}: {
  config: ClientProjectConfig;
  children: React.ReactNode;
}) {
  const value = useMemo<ProjectConfigValue>(() => {
    return {
      config,
      characterCategoryColor: (cat) => pick(config.characterCategories, cat, "color", FALLBACK_COLOR),
      characterCategoryLabel: (cat) => pick(config.characterCategories, cat, "label", cat),
      artifactCategoryColor: (cat) => pick(config.artifactCategories, cat, "color", FALLBACK_COLOR),
      artifactCategoryLabel: (cat) => pick(config.artifactCategories, cat, "label", cat),
      relationColor: (type) => pick(config.relationTypes, type, "color", FALLBACK_COLOR),
      relationLabel: (type) => pick(config.relationTypes, type, "label", type),
      eraLabel: (era) => config.eraLayers[String(era)] ?? `第 ${era} 层`,
    };
  }, [config]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjectConfig(): ProjectConfigValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectConfig 必须在 ProjectConfigProvider 内使用");
  return v;
}
