import { NextRequest, NextResponse } from "next/server";
import { loadDataset } from "@/lib/data";
import { callLLMStream } from "@/lib/whatif/llmClient";
import {
  parseGeneratedProfile,
  parseGeneratedRelationships,
  parseGeneratedTargetIds,
  UserCharacterGenerationError,
} from "@/lib/userCharacterGeneration";
import { GenerateUserCharacterInput } from "@/schemas/userCharacter";
import { adaptationWork } from "@/lib/userEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BATCH_SIZE = 10;
const MAX_STRUCTURED_ATTEMPTS = 3;

async function generateStructured<T>(
  system: string,
  user: string,
  maxTokens: number,
  parse: (raw: string) => T,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_STRUCTURED_ATTEMPTS; attempt += 1) {
    let raw = "";
    const repair = attempt === 1
      ? ""
      : `\n\n上一次输出未通过校验：${lastError instanceof Error ? lastError.message : String(lastError)}。请修复并只返回合法 JSON。`;
    await callLLMStream(system, `${user}${repair}`, maxTokens, (delta) => {
      raw += delta;
    }, () => {
      raw = "";
    });
    try {
      return parse(raw);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型结构化输出失败");
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = GenerateUserCharacterInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let loaded;
  try {
    loaded = loadDataset(input.projectSlug);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
  const { config } = loaded;
  if (!config.characterCategories[input.category]) {
    return NextResponse.json({ error: `未知人物分类：${input.category}` }, { status: 400 });
  }
  const duplicateName = [
    ...loaded.dataset.characters.map((character) => character.name_zh),
    ...input.candidates.map((candidate) => candidate.nameZh),
  ].some((name) => name.trim() === input.nameZh.trim());
  if (duplicateName) {
    return NextResponse.json({ error: `已存在同名人物「${input.nameZh}」` }, { status: 409 });
  }
  if (input.relationCount > input.candidates.length) {
    return NextResponse.json({ error: "关系数量超过当前已有的人物数" }, { status: 400 });
  }

  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const requiredTargetIds = Array.from(new Set(input.requiredCharacterIds));
  const missingRequired = requiredTargetIds.find((id) => !candidateById.has(id));
  if (missingRequired) {
    return NextResponse.json({ error: `手选人物不存在：${missingRequired}` }, { status: 400 });
  }
  if (requiredTargetIds.length > input.relationCount) {
    return NextResponse.json({ error: "手选人物数不能超过关系总数" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const canonicalWork = loaded.dataset.characters
          .flatMap((character) => character.events)
          .find((event) => event.source?.work)?.source?.work;
        const sourceWork = adaptationWork(canonicalWork ?? config.title.replace(/人物谱$/, ""));
        const remainingCount = input.relationCount - requiredTargetIds.length;
        const selectable = input.candidates.filter((candidate) => !requiredTargetIds.includes(candidate.id));
        let selectedTargetIds: string[] = [];

        if (remainingCount > 0) {
          send("progress", { stage: "targets", completed: 0, total: remainingCount });
          const targetSystem = [
            "你是文学人物关系图谱编辑。",
            "只输出 JSON，不输出 Markdown、解释或额外文字。",
            `输出格式：{\"targetIds\":[\"人物id\"]}，必须恰好 ${remainingCount} 个且不重复。`,
          ].join("\n");
          const targetUser = [
            `为新增人物「${input.nameZh}」选择 ${remainingCount} 个最适合建立关系的人物。`,
            `背景假设：${input.background}`,
            `人物时代层：${input.eraLayer}`,
            "优先选择背景、时代和事件上合理的人物；除非背景明确要求，否则不要跨时代。",
            `已经由用户指定、不得重复选择：${json(requiredTargetIds)}`,
            `候选人物：${json(selectable)}`,
          ].join("\n\n");
          const allowed = new Set(selectable.map((candidate) => candidate.id));
          selectedTargetIds = await generateStructured(
            targetSystem,
            targetUser,
            Math.max(1024, remainingCount * 40),
            (raw) => parseGeneratedTargetIds(raw, allowed, remainingCount),
          );
          send("progress", { stage: "targets", completed: remainingCount, total: remainingCount });
        }

        const targetIds = [...requiredTargetIds, ...selectedTargetIds];
        send("progress", { stage: "profile", completed: 0, total: 1 });
        const profileSystem = [
          "你是文学人物设定编辑。只输出严格 JSON，不输出 Markdown。",
          "人物资料必须服从用户背景假设，不得冒充原典内容。",
          "events 生成 3 条主要事件；字段为 title 和 desc。",
          "输出字段：nameEn, aliases, epithet, bio, events, weapons, skills, domains, mounts。",
          "所有数组都必须输出；epithet 可为 null。",
        ].join("\n");
        const profileUser = [
          `作品：${config.title}`,
          `人物名：${input.nameZh}`,
          `背景假设：${input.background}`,
          `用户提供的别名：${json(input.aliases)}`,
          `用户提供的称号：${input.epithet ?? "无"}`,
          `分类：${config.characterCategories[input.category].label}`,
          `时代层：${config.eraLayers[String(input.eraLayer)] ?? input.eraLayer}`,
          `将建立关系的人物：${json(targetIds.map((id) => candidateById.get(id)))}`,
        ].join("\n\n");
        const profile = await generateStructured(
          profileSystem,
          profileUser,
          4096,
          (raw) => {
            const generated = parseGeneratedProfile(raw);
            if (generated.events.length !== 3) {
              throw new UserCharacterGenerationError(
                `主要事件数量不正确：期望 3，实际 ${generated.events.length}`,
                raw,
              );
            }
            return generated;
          },
        );
        send("progress", { stage: "profile", completed: 1, total: 1 });

        const relationTypes = Object.entries(config.relationTypes).map(([id, swatch]) => ({
          id,
          label: swatch.label,
        }));
        const allowedRelationTypes = new Set(relationTypes.map((type) => type.id));
        const relationships = [];
        const batches = Math.ceil(targetIds.length / BATCH_SIZE);
        for (let index = 0; index < batches; index += 1) {
          const batchTargetIds = targetIds.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE);
          send("progress", { stage: "relationships", completed: index, total: batches });
          const relationSystem = [
            "你是文学人物关系图谱编辑。只输出严格 JSON，不输出 Markdown。",
            "输出 {\"relationships\":[...]}，每个对象包含 targetId、primaryType、compositeTypes、title、desc。",
            "每个指定 targetId 必须且只能出现一次。primaryType 和 compositeTypes 只能使用给定关系类型 id。",
            "每段故事是改编内容，写清人物如何相识、冲突或合作，不得声称来自原典。",
          ].join("\n");
          const relationUser = [
            `作品：${config.title}`,
            `新增人物：${input.nameZh}`,
            `人物背景：${input.background}`,
            `人物资料：${json(profile)}`,
            `关系类型：${json(relationTypes)}`,
            `本批关系对象：${json(batchTargetIds.map((id) => candidateById.get(id)))}`,
          ].join("\n\n");
          const expected = new Set(batchTargetIds);
          const batch = await generateStructured(
            relationSystem,
            relationUser,
            Math.max(2048, batchTargetIds.length * 600),
            (raw) => parseGeneratedRelationships(raw, expected, allowedRelationTypes),
          );
          relationships.push(...batch);
          send("progress", { stage: "relationships", completed: index + 1, total: batches });
        }

        send("done", { profile, relationships, sourceWork });
      } catch (error) {
        send("error", {
          code: error instanceof UserCharacterGenerationError ? "PARSE_ERROR" : "LLM_ERROR",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
