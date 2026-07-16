import { NextRequest, NextResponse } from "next/server";
import { CharacterImageRequest } from "@/schemas/characterImage";
import { loadDataset } from "@/lib/data";
import {
  branchDirectoryKey,
  characterImageFingerprint,
  fallbackCharacterImagePrompt,
  findBranchPrompt,
  findCharacterImageAsset,
  resolveBranchLineage,
} from "@/lib/server/branchImageAssets";
import {
  ImageGenerationTimeoutError,
  runBranchPortraitGeneration,
  synthesizeCharacterImagePrompt,
} from "@/lib/server/characterImageGeneration";
import { getSessionUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/whatif/db";
import { ownsUserContentScope } from "@/lib/server/userProjectContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const activeCharacters = new Set<string>();
const branchTails = new Map<string, Promise<unknown>>();

function enqueueBranch<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = branchTails.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  branchTails.set(key, next);
  const cleanup = () => {
    if (branchTails.get(key) === next) branchTails.delete(key);
  };
  void next.then(cleanup, cleanup);
  return next;
}

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const user = getSessionUserFromHeaders(req.headers);
  if (!user) {
    return NextResponse.json({ error: "请先登录后使用分支图像", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CharacterImageRequest.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  if (input.branchId.startsWith("user-branch:")) {
    if (!await ownsUserContentScope(user.id, input.projectSlug, input.branchId)) {
      return NextResponse.json({ error: "分支不存在" }, { status: 404 });
    }
  } else {
    const ownedBranch = await prisma.whatIfBranch.findFirst({
      where: {
        id: input.branchId,
        session: { ownerId: user.id, projectSlug: input.projectSlug },
      },
      select: { id: true },
    });
    if (!ownedBranch) return NextResponse.json({ error: "分支不存在" }, { status: 404 });
  }

  let loaded;
  let lineage: string[];
  try {
    loaded = loadDataset(input.projectSlug);
    lineage = await resolveBranchLineage(input.branchId);
  } catch (error) {
    return errorResponse(error, 404);
  }

  if (input.action === "status") {
    const entries = await Promise.all(input.characterIds.map(async (characterId) => [
      characterId,
      await findCharacterImageAsset(input.projectSlug, lineage, characterId),
    ] as const));
    return NextResponse.json({ assets: Object.fromEntries(entries) });
  }

  const { character } = input;
  if (loaded.dataset.characters.some((candidate) => candidate.id === character.id)) {
    return NextResponse.json({ error: "原始主分支人物不能通过此入口生成图像" }, { status: 403 });
  }
  const category = loaded.config.characterCategories[character.category];
  if (!category) {
    return NextResponse.json({ error: `未知人物分类：${character.category}` }, { status: 400 });
  }

  const taskKey = `${input.projectSlug}\u0000${input.branchId}\u0000${character.id}`;
  if (activeCharacters.has(taskKey)) {
    return NextResponse.json({ error: "该人物的图像已经在生成中" }, { status: 409 });
  }
  activeCharacters.add(taskKey);
  console.info(
    `[character-image] task started project=${input.projectSlug} branch=${input.branchId} character=${character.id}`,
  );

  try {
    const asset = await enqueueBranch(`${input.projectSlug}\u0000${input.branchId}`, async () => {
      if (!input.regenerate) {
        const existing = await findCharacterImageAsset(input.projectSlug, [input.branchId], character.id);
        if (existing) return existing;
      }

      const fingerprint = characterImageFingerprint(character, input.background);
      const cached = await findBranchPrompt(input.projectSlug, lineage, character.id);
      let prompt: string;
      let promptSource: "llm" | "template";
      if (cached?.metadata.fingerprint === fingerprint) {
        prompt = cached.prompt;
        promptSource = cached.metadata.source;
      } else {
        try {
          prompt = await synthesizeCharacterImagePrompt({
            projectTitle: loaded.config.title,
            categoryLabel: category.label,
            character,
            background: input.background,
          });
          promptSource = "llm";
        } catch (error) {
          console.warn(
            `[character-image] prompt synthesis failed; using template: ${error instanceof Error ? error.message : String(error)}`,
          );
          prompt = fallbackCharacterImagePrompt(character, input.background);
          promptSource = "template";
        }
      }

      await runBranchPortraitGeneration({
        project: input.projectSlug,
        branch: branchDirectoryKey(input.branchId),
        characterId: character.id,
        prompt,
        fingerprint,
        promptSource,
      });
      const generated = await findCharacterImageAsset(input.projectSlug, [input.branchId], character.id);
      if (!generated) throw new Error("图像管线完成，但未找到 portrait/thumb 产物");
      return generated;
    });
    return NextResponse.json({ asset });
  } catch (error) {
    console.error(
      `[character-image] task failed project=${input.projectSlug} branch=${input.branchId} character=${character.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return errorResponse(error, error instanceof ImageGenerationTimeoutError ? 504 : 500);
  } finally {
    activeCharacters.delete(taskKey);
  }
}
