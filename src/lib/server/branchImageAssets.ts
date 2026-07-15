import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Character } from "@/schemas/character";
import type { CharacterImageAsset } from "@/schemas/characterImage";
import { withBasePath } from "@/lib/basePath";
import { prisma } from "@/lib/whatif/db";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");

export interface PromptMetadata {
  fingerprint: string;
  updatedAt: string;
  source: "llm" | "template";
}

export function branchDirectoryKey(branchId: string): string {
  const readable = branchId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "branch";
  const digest = createHash("sha256").update(branchId).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

export function characterImageFingerprint(character: Character, background?: string): string {
  const visualIdentity = {
    name_zh: character.name_zh,
    name_en: character.name_en,
    aliases: character.aliases,
    epithet: character.epithet,
    category: character.category,
    era_layer: character.era_layer,
    bio: character.bio,
    events: character.events.map(({ title, desc }) => ({ title, desc })),
    weapons: character.weapons,
    skills: character.skills,
    domains: character.domains,
    mounts: character.mounts,
    background: background?.trim() ?? "",
  };
  return createHash("sha256").update(JSON.stringify(visualIdentity)).digest("hex");
}

export function fallbackCharacterImagePrompt(character: Character, background?: string): string {
  const facts = [
    character.name_zh,
    character.epithet,
    background?.trim(),
    character.bio,
    character.weapons.length ? `标志性武器：${character.weapons.join("、")}` : null,
    character.skills.length ? `能力与技艺：${character.skills.join("、")}` : null,
    character.domains.length ? `身份领域：${character.domains.join("、")}` : null,
    character.mounts.length ? `坐骑：${character.mounts.join("、")}` : null,
    character.events.slice(0, 5).map((event) => `${event.title}：${event.desc}`).join("；"),
  ].filter(Boolean);
  return `${facts.join("，")}。人物单人立绘，依据人物身份、经历和性格设计年龄、容貌、服饰、神态与姿态，主体完整清晰，2:3竖向构图，不添加文字、题款、边框或水印。`;
}

function branchImagesDir(projectSlug: string, branchId: string): string {
  return path.join(PROJECTS_ROOT, projectSlug, "images", "branches", branchDirectoryKey(branchId));
}

function assetPaths(projectSlug: string, branchId: string, characterId: string) {
  const directory = branchImagesDir(projectSlug, branchId);
  return {
    directory,
    portrait: path.join(directory, "portraits", `${characterId}.webp`),
    thumb: path.join(directory, "thumbs", `${characterId}.webp`),
    prompts: path.join(directory, "prompts.json"),
    promptMeta: path.join(directory, "prompt-meta.json"),
  };
}

async function readJsonRecord<T>(file: string): Promise<Record<string, T>> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, T>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function readBranchPrompt(
  projectSlug: string,
  branchId: string,
  characterId: string,
): Promise<{ prompt: string; metadata: PromptMetadata } | null> {
  const paths = assetPaths(projectSlug, branchId, characterId);
  const [prompts, metadata] = await Promise.all([
    readJsonRecord<string>(paths.prompts),
    readJsonRecord<PromptMetadata>(paths.promptMeta),
  ]);
  return prompts[characterId] && metadata[characterId]
    ? { prompt: prompts[characterId], metadata: metadata[characterId] }
    : null;
}

export async function findBranchPrompt(
  projectSlug: string,
  branchLineage: readonly string[],
  characterId: string,
): Promise<{ prompt: string; metadata: PromptMetadata } | null> {
  for (const branchId of branchLineage) {
    const stored = await readBranchPrompt(projectSlug, branchId, characterId);
    if (stored) return stored;
  }
  return null;
}

export async function resolveBranchLineage(branchId: string): Promise<string[]> {
  if (branchId.startsWith("user-branch:")) return [branchId];

  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = branchId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const branch: { id: string; parentTurn: { branchId: string } | null } | null = await prisma.whatIfBranch.findUnique({
      where: { id: currentId },
      select: { id: true, parentTurn: { select: { branchId: true } } },
    });
    if (!branch) {
      if (lineage.length === 0) throw new Error(`分支不存在：${branchId}`);
      break;
    }
    lineage.push(branch.id);
    currentId = branch.parentTurn?.branchId ?? null;
  }
  return lineage;
}

export async function findCharacterImageAsset(
  projectSlug: string,
  branchLineage: readonly string[],
  characterId: string,
): Promise<CharacterImageAsset | null> {
  for (const branchId of branchLineage) {
    const paths = assetPaths(projectSlug, branchId, characterId);
    try {
      const [portrait, thumb] = await Promise.all([fs.stat(paths.portrait), fs.stat(paths.thumb)]);
      const version = String(Math.max(portrait.mtimeMs, thumb.mtimeMs));
      const key = branchDirectoryKey(branchId);
      return {
        portrait: withBasePath(`/p/${projectSlug}/branches/${key}/portraits/${characterId}.webp?v=${version}`),
        thumb: withBasePath(`/p/${projectSlug}/branches/${key}/thumbs/${characterId}.webp?v=${version}`),
        ownerBranchId: branchId,
        version,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

export async function removeBranchImages(projectSlug: string, branchId: string): Promise<void> {
  await fs.rm(branchImagesDir(projectSlug, branchId), { recursive: true, force: true });
}
