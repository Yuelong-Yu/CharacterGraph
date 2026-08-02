/**
 * POST /api/whatif - 创建 session + 调 LLM 生成第一个 turn（SSE 流式，Week 3）
 * GET  /api/whatif?projectSlug=xxx - 列出项目的所有 session
 *
 * SSE 协议：
 *   event: delta   data: {text: "..."}                  // LLM 流式 token
 *   event: reset   data: {reason, providerAttempt?, parseAttempt?}
 *                                                          // 重试，丢弃之前的 token
 *   event: done    data: {turnId, sessionId, diff, narrative, choices}
 *   event: error   data: {code, message}
 *
 * 客户端用 fetch + ReadableStream 接收（EventSource 不支持 POST）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";
import { loadDataset } from "@/lib/data";
import { buildContext, INITIAL_MAX_NODES } from "@/lib/whatif/contextBuilder";
import { buildCacheableSystemPrompt, buildUserPrompt, LLMParseError } from "@/lib/whatif/promptBuilder";
import {
  generateParsedWhatIf,
  LLMRefusalError,
  WHAT_IF_MAX_TOKENS,
  type ProviderTimingEvent,
} from "@/lib/whatif/llmClient";
import type { WhatIfRecoveryReason } from "@/lib/whatif/recovery";
import { normalizeDiffAgainstDataset } from "@/lib/whatif/diffApplier";
import { validateNarrative } from "@/lib/whatif/validation";
import { CreateWhatIfSessionInput } from "@/schemas/whatif";
import { mergeDatasetOverlay } from "@/lib/userCharacters";
import { getSessionUserFromHeaders } from "@/lib/auth";
import { startSSEKeepAlive } from "@/lib/whatif/sse";
import { createWhatIfTiming } from "@/lib/whatif/timing";
import {
  confirmWhatIfQuota,
  quotaErrorResponse,
  releaseWhatIfQuota,
  reserveWhatIfQuota,
} from "@/lib/server/aiQuotaClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const accountUser = getSessionUserFromHeaders(req.headers);
  if (!accountUser) {
    return NextResponse.json({ error: "请先登录后查看推演历史", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const projectSlug = req.nextUrl.searchParams.get("projectSlug");

  const sessions = await prisma.whatIfSession.findMany({
    where: { ownerId: accountUser.id, ...(projectSlug ? { projectSlug } : {}) },
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
  const requestStartedAt = performance.now();
  const timing = createWhatIfTiming("initial");
  const accountUser = getSessionUserFromHeaders(req.headers);
  if (!accountUser) {
    return NextResponse.json({ error: "请先登录后创建同人推演", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
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
    subset = buildContext(dataset, input.characterId, {
      maxNodes: INITIAL_MAX_NODES,
      relevanceText: [input.sourceEventTitle, input.premise].filter(Boolean).join("\n"),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `上下文构建失败: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  // 3. 构建 prompt
  const system = buildCacheableSystemPrompt(subset, config, {
    knownCharacters: dataset.characters.map(({ id, name_zh }) => ({ id, name_zh })),
  });
  const user = buildUserPrompt({
    characterId: input.characterId,
    characterName: subset.core.name_zh,
    eventTitle: input.sourceEventTitle ?? null,
    premise: input.premise,
    premiseType: input.premiseType,
  });
  timing.mark("preparationMs", requestStartedAt);

  const quotaRequestKey = `charactergraph:whatif:${crypto.randomUUID()}`;
  const quotaReserveStartedAt = performance.now();
  try {
    await reserveWhatIfQuota(req, [quotaRequestKey], "whatif_initial");
    timing.mark("quotaReserveMs", quotaReserveStartedAt);
  } catch (error) {
    timing.mark("quotaReserveMs", quotaReserveStartedAt);
    timing.report("error", {
      errorCode: "QUOTA_RESERVE_FAILED",
      promptChars: system.cacheable.length + system.dynamic.length + user.length,
    });
    return quotaErrorResponse(error) ?? NextResponse.json(
      { error: "AI 额度服务暂时不可用，请稍后重试。", code: "QUOTA_SERVICE_UNAVAILABLE" },
      { status: 503 },
    );
  }

  // 4. SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let turnPersisted = false;
      let firstTextReceived = false;
      let firstTextRecorded = false;
      let outputChars = 0;
      let recoveryCount = 0;
      const recoveryReasons: WhatIfRecoveryReason[] = [];
      let providerRequestReadyMs: number | undefined;
      let providerFirstTextMs: number | undefined;
      let providerTotalMs = 0;
      let providerAttemptCount = 0;
      let providerInputTokens = 0;
      let providerCacheReadInputTokens = 0;
      let providerCacheCreationInputTokens = 0;
      let providerOutputTokens = 0;
      const recordProviderTiming = (event: ProviderTimingEvent) => {
        if (event.stage === "request-ready" && providerRequestReadyMs === undefined) {
          providerRequestReadyMs = event.elapsedMs;
        }
        if (event.stage === "first-text" && providerFirstTextMs === undefined) {
          providerFirstTextMs = event.elapsedMs;
        }
        if (event.stage === "attempt-complete") {
          providerTotalMs += event.elapsedMs;
          providerAttemptCount += 1;
        }
        if (event.stage === "usage") {
          providerInputTokens += event.inputTokens ?? 0;
          providerCacheReadInputTokens += event.cacheReadInputTokens ?? 0;
          providerCacheCreationInputTokens += event.cacheCreationInputTokens ?? 0;
          providerOutputTokens += event.outputTokens ?? 0;
        }
      };
      const providerTiming = () => ({
        providerRequestReadyMs,
        providerFirstTextMs,
        providerTotalMs,
        providerAttemptCount,
        providerInputTokens,
        providerCacheReadInputTokens,
        providerCacheCreationInputTokens,
        providerOutputTokens,
      });
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const stopKeepAlive = startSSEKeepAlive(controller, encoder);

      try {
        send("status", { stage: "thinking" });
        const modelStartedAt = performance.now();
        // 5-6. 流式生成并解析；重试时通知客户端清空失败草稿
        const llmOutput = await generateParsedWhatIf(
          system,
          user,
          WHAT_IF_MAX_TOKENS,
          (delta) => {
            if (!firstTextReceived) {
              firstTextReceived = true;
              send("status", { stage: "generating" });
            }
            if (!firstTextRecorded) {
              firstTextRecorded = true;
              timing.mark("firstTextMs", requestStartedAt);
            }
            outputChars += delta.length;
            send("delta", { text: delta });
          },
          (recovery) => {
            firstTextReceived = false;
            outputChars = 0;
            recoveryCount += 1;
            recoveryReasons.push(recovery.reason);
            send("status", { stage: "thinking" });
            send("reset", recovery);
          },
          { onProviderTiming: recordProviderTiming },
        );
        timing.mark("modelMs", modelStartedAt);
        send("status", { stage: "finalizing" });

        // 6.5 清理重复新增并做来源校验
        const validationStartedAt = performance.now();
        const diff = normalizeDiffAgainstDataset(dataset, llmOutput.diff, {
          premise: input.premise,
          narrative: llmOutput.narrative,
        });
        const validation = validateNarrative(llmOutput.narrative, dataset, diff);
        timing.mark("validationMs", validationStartedAt);

        // 7. 落库：session + root branch + turn
        const persistStartedAt = performance.now();
        const session = await prisma.whatIfSession.create({
          data: {
            ownerId: accountUser.id,
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
        timing.mark("persistMs", persistStartedAt);

        const turn = session.branches[0].turns[0];
        turnPersisted = true;
        const quotaConfirmStartedAt = performance.now();
        await confirmWhatIfQuota(req, [quotaRequestKey]);
        timing.mark("quotaConfirmMs", quotaConfirmStartedAt);

        timing.report("success", {
          promptChars: system.cacheable.length + system.dynamic.length + user.length,
          outputChars,
          recoveryCount,
          recoveryReasons,
          ...providerTiming(),
        });

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
        const errorCode = e instanceof LLMRefusalError
          ? "LLM_REFUSAL"
          : e instanceof LLMParseError
            ? "PARSE_ERROR"
            : "LLM_ERROR";
        timing.report("error", {
          errorCode,
          promptChars: system.cacheable.length + system.dynamic.length + user.length,
          outputChars,
          recoveryCount,
          recoveryReasons,
          ...providerTiming(),
        });
        if (!turnPersisted) {
          await releaseWhatIfQuota(req, [quotaRequestKey]);
        }
        if (e instanceof LLMRefusalError) {
          send("error", { code: "LLM_REFUSAL", message: e.message });
        } else if (e instanceof LLMParseError) {
          send("error", { code: "PARSE_ERROR", message: e.message, raw: e.raw });
        } else {
          const message = e instanceof Error ? e.message : String(e);
          send("error", { code: "LLM_ERROR", message });
        }
      } finally {
        stopKeepAlive();
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
