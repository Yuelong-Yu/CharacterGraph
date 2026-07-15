/**
 * POST /api/whatif - 创建 session + 调 LLM 生成第一个 turn（SSE 流式，Week 3）
 * GET  /api/whatif?projectSlug=xxx - 列出项目的所有 session
 *
 * SSE 协议：
 *   event: delta   data: {text: "..."}                  // LLM 流式 token
 *   event: reset   data: {}                             // 重试，丢弃之前的 token
 *   event: done    data: {turnId, sessionId, diff, narrative, choices}
 *   event: error   data: {code, message}
 *
 * 客户端用 fetch + ReadableStream 接收（EventSource 不支持 POST）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";
import { loadDataset } from "@/lib/data";
import { buildContext } from "@/lib/whatif/contextBuilder";
import { buildSystemPrompt, buildUserPrompt, LLMParseError } from "@/lib/whatif/promptBuilder";
import { generateParsedWhatIf } from "@/lib/whatif/llmClient";
import { normalizeDiffAgainstDataset } from "@/lib/whatif/diffApplier";
import { validateNarrative } from "@/lib/whatif/validation";
import { CreateWhatIfSessionInput } from "@/schemas/whatif";
import { mergeDatasetOverlay } from "@/lib/userCharacters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");

  const sessions = await prisma.whatIfSession.findMany({
    where: projectSlug ? { projectSlug } : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      branches: {
        select: { id: true, turns: { select: { status: true } } },
      },
    },
  });

  const summaries = sessions.map((s) => ({
    id: s.id,
    projectSlug: s.projectSlug,
    title: s.title,
    status: s.status as "active" | "archived",
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    branchCount: s.branches.length,
    turnCount: s.branches.reduce(
      (sum, branch) => sum + branch.turns.filter((turn) => turn.status !== "deleted").length,
      0,
    ),
  }));

  return NextResponse.json({ sessions: summaries });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateWhatIfSessionInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // 1. 加载项目数据 + config
  let loaded;
  try {
    loaded = loadDataset(input.projectSlug);
  } catch (e) {
    return NextResponse.json(
      { error: `项目加载失败: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }
  const config = loaded.config;
  const canonicalDataset = loaded.dataset;
  const dataset = mergeDatasetOverlay(canonicalDataset, input.datasetOverlay);

  // 2. 构建上下文子集
  let subset;
  try {
    subset = buildContext(dataset, input.characterId);
  } catch (e) {
    return NextResponse.json(
      { error: `上下文构建失败: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  // 3. 构建 prompt
  const system = buildSystemPrompt(subset, config, {
    knownCharacters: dataset.characters.map(({ id, name_zh }) => ({ id, name_zh })),
  });
  const user = buildUserPrompt({
    characterId: input.characterId,
    characterName: subset.core.name_zh,
    eventTitle: input.sourceEventTitle ?? null,
    premise: input.premise,
    premiseType: input.premiseType,
  });

  // 4. SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // 5-6. 流式生成并解析；重试时通知客户端清空失败草稿
        const llmOutput = await generateParsedWhatIf(
          system,
          user,
          8192,
          (delta) => send("delta", { text: delta }),
          () => send("reset", {}),
        );

        // 6.5 清理重复新增并做来源校验
        const diff = normalizeDiffAgainstDataset(dataset, llmOutput.diff);
        const validation = validateNarrative(llmOutput.narrative, dataset, diff);

        // 7. 落库：session + root branch + turn
        const session = await prisma.whatIfSession.create({
          data: {
            projectSlug: input.projectSlug,
            characterId: input.characterId,
            title: input.title,
            status: "active",
            datasetOverlay: input.datasetOverlay as unknown as object | undefined,
            branches: {
              create: [
                {
                  title: "主时间线",
                  isActive: true,
                  datasetOverlay: input.datasetOverlay as unknown as object | undefined,
                  turns: {
                    create: [
                      {
                        order: 1,
                        premise: input.premise,
                        premiseType: input.premiseType,
                        sourceEventTitle: input.sourceEventTitle ?? null,
                        diff: diff as unknown as object,
                        narrative: llmOutput.narrative as unknown as object,
                        choices: llmOutput.choices,
                        status: "completed",
                        validation: validation as unknown as object,
                      },
                    ],
                  },
                },
              ],
            },
          },
          include: {
            branches: {
              orderBy: { createdAt: "asc" },
              include: { turns: { orderBy: { order: "asc" } } },
            },
          },
        });

        const turn = session.branches[0].turns[0];

        // 8. 推 done 事件，带完整解析结果 + DB id + 校验结果
        send("done", {
          turnId: turn.id,
          sessionId: session.id,
          branchId: session.branches[0].id,
          diff,
          narrative: llmOutput.narrative,
          choices: llmOutput.choices,
          validation,
        });
      } catch (e) {
        if (e instanceof LLMParseError) {
          send("error", { code: "PARSE_ERROR", message: e.message, raw: e.raw });
        } else {
          const message = e instanceof Error ? e.message : String(e);
          send("error", { code: "LLM_ERROR", message });
        }
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
      "X-Accel-Buffering": "no", // 禁用 nginx 缓冲，确保流式
    },
  });
}
