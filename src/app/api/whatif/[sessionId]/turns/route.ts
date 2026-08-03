/**
 * POST /api/whatif/[sessionId]/turns - 续写下一 turn（SSE 流式）
 *
 * 输入: { userInput: string }  // 用户选了上一 turn 的某个 choice，或自由输入
 *
 * 流程:
 *   1. 加载 session + branches + turns
 *   2. 找 active branch（或 root branch）
 *   3. 重放已有 turns 的 diff 得到 effective dataset
 *   4. 基于 effective dataset + session.characterId 构建上下文
 *   5. 构建续写 prompt（含前文摘要 + userInput）
 *   6. 流式调 LLM，推 delta 事件
 *   7. 解析输出，落库新 turn（order = max + 1）
 *   8. 推 done 事件
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";
import { loadDataset } from "@/lib/data";
import { buildContext, maxNodesForCompletedContinuations } from "@/lib/whatif/contextBuilder";
import {
  buildCacheableSystemPrompt,
  buildContinuationUserPrompt,
  LLMParseError,
  type BranchPoint,
  type PriorTurnSummary,
} from "@/lib/whatif/promptBuilder";
import {
  generateParsedWhatIf,
  LLMRefusalError,
  WHAT_IF_MAX_TOKENS,
  type ProviderTimingEvent,
} from "@/lib/whatif/llmClient";
import type { WhatIfRecoveryReason } from "@/lib/whatif/recovery";
import { applyDiff, normalizeDiffAgainstDataset } from "@/lib/whatif/diffApplier";
import { validateNarrative } from "@/lib/whatif/validation";
import { ContinueTurnInput } from "@/schemas/whatif";
import type { Dataset } from "@/schemas/character";
import type { GraphDiff, NarrativeSegment } from "@/schemas/whatif";
import { mergeDatasetOverlay } from "@/lib/userCharacters";
import { Dataset as DatasetSchema } from "@/schemas/character";
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

interface PrismaTurn {
  id: string;
  order: number;
  premise: string;
  premiseType: string;
  sourceEventTitle: string | null;
  diff: GraphDiff;
  narrative: NarrativeSegment[];
  choices: string[];
  status: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const requestStartedAt = performance.now();
  const timing = createWhatIfTiming("continue");
  const accountUser = getSessionUserFromHeaders(req.headers);
  if (!accountUser) {
    return NextResponse.json({ error: "请先登录后续写推演", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const { sessionId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ContinueTurnInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // 1. 加载 session + branches + turns
  const session = await prisma.whatIfSession.findFirst({
    where: { id: sessionId, ownerId: accountUser.id },
    include: {
      branches: {
        orderBy: { createdAt: "asc" },
        include: { turns: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 2. 找 active branch（或第一个 branch）
  const branch = session.branches.find((b) => b.isActive) ?? session.branches[0];
  if (!branch) {
    return NextResponse.json({ error: "Session has no branch" }, { status: 400 });
  }

  // 3. 组装 priorTurns：当前 branch 的 turns + 若有 parentTurnId，加上 parent branch 中 order ≤ parentTurn 的 turns
  const ownTurns: PrismaTurn[] = (branch.turns as unknown as PrismaTurn[])
    .filter((turn) => turn.status !== "deleted");

  let parentTurns: PrismaTurn[] = [];
  if (branch.parentTurnId) {
    // 找 parentTurn 所属的 branch
    const parentTurn = await prisma.whatIfTurn.findUnique({
      where: { id: branch.parentTurnId },
    });
    if (parentTurn) {
      const parentBranch = await prisma.whatIfBranch.findUnique({
        where: { id: parentTurn.branchId },
        include: { turns: { orderBy: { order: "asc" } } },
      });
      if (parentBranch) {
        parentTurns = (parentBranch.turns as unknown as PrismaTurn[]).filter(
          (t) => t.status !== "deleted" && t.order <= parentTurn.order,
        );
      }
    }
  }

  const priorTurns = [...parentTurns, ...ownTurns];
  if (priorTurns.length === 0) {
    return NextResponse.json(
      { error: "Branch has no prior turn; use POST /api/whatif to create the first turn" },
      { status: 400 },
    );
  }

  // 4. 加载 base dataset + config（一次调用）
  let loaded;
  try {
    loaded = loadDataset(session.projectSlug);
  } catch (e) {
    return NextResponse.json(
      { error: `项目加载失败: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
  const rawBranchOverlay = input.datasetOverlay ?? branch.datasetOverlay ?? session.datasetOverlay;
  const storedOverlay = rawBranchOverlay && typeof rawBranchOverlay === "object"
    ? rawBranchOverlay as { characters?: unknown; relations?: unknown }
    : null;
  const overlay = storedOverlay
    ? {
        characters: DatasetSchema.shape.characters.parse(storedOverlay.characters ?? []),
        relations: DatasetSchema.shape.relations.parse(storedOverlay.relations ?? []),
      }
    : undefined;
  const canonicalDataset = loaded.dataset;
  const baseDataset = mergeDatasetOverlay(canonicalDataset, overlay);
  const config = loaded.config;

  // 5. 重放 diff 得到 effective dataset（含 parent branch 的 inherited turns）
  const effectiveDataset = priorTurns.reduce<Dataset>(
    (acc, t) => applyDiff(acc, normalizeDiffAgainstDataset(acc, t.diff, {
      premise: t.premise,
      narrative: t.narrative,
    })),
    baseDataset,
  );
  const branchCharacterIds = new Set(
    priorTurns.flatMap((turn) => turn.diff.addedNodes.map((character) => character.id)),
  );
  const priorityCharacterIds = new Set(
    priorTurns.flatMap((turn) => [
      ...turn.diff.modifiedEvents.map((event) => event.characterId),
      ...turn.diff.replacedEvents.map((event) => event.characterId),
      ...turn.narrative.flatMap((segment) => segment.characterIds ?? []),
    ]),
  );
  const relevanceText = [
    ...priorTurns.flatMap((turn) => [
      turn.sourceEventTitle ?? "",
      turn.premise,
      ...turn.narrative.map((segment) => segment.text),
    ]),
    input.userInput,
  ].join("\n");
  const contextOptions = {
    maxNodes: maxNodesForCompletedContinuations(Math.max(0, priorTurns.length - 1)),
    relevanceText,
    priorityCharacterIds,
  };

  // 6. 构建上下文（基于 effective dataset）
  let canonicalSubset;
  let subset;
  try {
    canonicalSubset = buildContext(baseDataset, session.characterId, contextOptions);
    subset = buildContext(effectiveDataset, session.characterId, { ...contextOptions, branchCharacterIds });
  } catch (e) {
    return NextResponse.json(
      { error: `上下文构建失败: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  // 7. 构建续写 prompt
  // 分支点信息用第一个 parent turn（或 ownTurn[0]）
  const rootTurn = priorTurns[0];
  const branchPoint: BranchPoint = {
    characterId: session.characterId,
    characterName: subset.core.name_zh,
    eventTitle: rootTurn.sourceEventTitle,
    premise: rootTurn.premise,
    premiseType: rootTurn.premiseType as BranchPoint["premiseType"],
  };

  const priorSummaries: PriorTurnSummary[] = priorTurns.map((t) => ({
    premise: t.premise,
    narrative: t.narrative.map((n) => ({ label: n.label, text: n.text })),
    userChoice: undefined,
  }));

  const system = buildCacheableSystemPrompt(canonicalSubset, config, {
    branchSubset: subset,
    knownCharacters: effectiveDataset.characters.map(({ id, name_zh }) => ({ id, name_zh })),
  });
  const user = buildContinuationUserPrompt(branchPoint, priorSummaries, input.userInput);
  timing.mark("preparationMs", requestStartedAt);

  const quotaRequestKey = `charactergraph:whatif:${crypto.randomUUID()}`;
  const quotaReserveStartedAt = performance.now();
  try {
    await reserveWhatIfQuota(req, [quotaRequestKey], "whatif_continue");
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
  if (input.datasetOverlay) {
    try {
      await prisma.whatIfBranch.update({
        where: { id: branch.id },
        data: { datasetOverlay: input.datasetOverlay as unknown as object },
      });
    } catch (error) {
      await releaseWhatIfQuota(req, [quotaRequestKey]);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "更新推演分支失败" },
        { status: 500 },
      );
    }
  }

  // 7. SSE 流式响应
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
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Continue persisting the turn after a background browser closes the stream.
        }
      };
      const stopKeepAlive = startSSEKeepAlive(controller, encoder);

      try {
        send("status", { stage: "thinking" });
        const modelStartedAt = performance.now();
        // 8. 流式生成并解析；重试时通知客户端清空失败草稿
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

        // 8.5 清理重复新增；原典校验始终基于不可变 base dataset
        const validationStartedAt = performance.now();
        const diff = normalizeDiffAgainstDataset(effectiveDataset, llmOutput.diff, {
          premise: input.userInput,
          narrative: llmOutput.narrative,
        });
        const validation = validateNarrative(
          llmOutput.narrative,
          baseDataset,
          diff,
          priorTurns.map((turn) => turn.diff),
        );
        timing.mark("validationMs", validationStartedAt);

        // 9. 落库新 turn
        // order 基于 branch 自己的 turns（不含 parent inherited），fork 后第一 turn order=1
        const persistStartedAt = performance.now();
        const allBranchTurns = branch.turns as unknown as PrismaTurn[];
        const nextOrder = Math.max(0, ...allBranchTurns.map((turn) => turn.order)) + 1;
        const newTurn = await prisma.whatIfTurn.create({
          data: {
            branchId: branch.id,
            order: nextOrder,
            premise: input.userInput, // 本轮的 premise 就是用户输入
            premiseType: "free_text",
            sourceEventTitle: null,
            diff: diff as unknown as object,
            narrative: llmOutput.narrative as unknown as object,
            choices: llmOutput.choices,
            status: "completed",
            validation: validation as unknown as object,
          },
        });
        timing.mark("persistMs", persistStartedAt);
        turnPersisted = true;
        const quotaConfirmStartedAt = performance.now();
        await confirmWhatIfQuota(req, [quotaRequestKey]);
        timing.mark("quotaConfirmMs", quotaConfirmStartedAt);

        const timingRecord = timing.report("success", {
          promptChars: system.cacheable.length + system.dynamic.length + user.length,
          outputChars,
          recoveryCount,
          recoveryReasons,
          ...providerTiming(),
        });

        send("done", {
          turnId: newTurn.id,
          sessionId: session.id,
          branchId: branch.id,
          order: newTurn.order,
          diff,
          narrative: llmOutput.narrative,
          choices: llmOutput.choices,
          validation,
          timing: timingRecord,
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
      "X-Accel-Buffering": "no",
    },
  });
}
