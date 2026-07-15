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
import { buildContext } from "@/lib/whatif/contextBuilder";
import {
  buildSystemPrompt,
  buildContinuationUserPrompt,
  LLMParseError,
  type BranchPoint,
  type PriorTurnSummary,
} from "@/lib/whatif/promptBuilder";
import { generateParsedWhatIf } from "@/lib/whatif/llmClient";
import { applyDiff, normalizeDiffAgainstDataset } from "@/lib/whatif/diffApplier";
import { validateNarrative } from "@/lib/whatif/validation";
import { ContinueTurnInput } from "@/schemas/whatif";
import type { Dataset } from "@/schemas/character";
import type { GraphDiff, NarrativeSegment } from "@/schemas/whatif";

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
  const session = await prisma.whatIfSession.findUnique({
    where: { id: sessionId },
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
  const ownTurns: PrismaTurn[] = branch.turns as unknown as PrismaTurn[];

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
          (t) => t.order <= parentTurn.order,
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
  const baseDataset = loaded.dataset;
  const config = loaded.config;

  // 5. 重放 diff 得到 effective dataset（含 parent branch 的 inherited turns）
  const effectiveDataset = priorTurns.reduce<Dataset>(
    (acc, t) => applyDiff(acc, t.diff),
    baseDataset,
  );

  // 6. 构建上下文（基于 effective dataset）
  let canonicalSubset;
  let subset;
  try {
    canonicalSubset = buildContext(baseDataset, session.characterId);
    subset = buildContext(effectiveDataset, session.characterId);
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

  const system = buildSystemPrompt(canonicalSubset, config, {
    branchSubset: subset,
    knownCharacters: effectiveDataset.characters.map(({ id, name_zh }) => ({ id, name_zh })),
  });
  const user = buildContinuationUserPrompt(branchPoint, priorSummaries, input.userInput);

  // 7. SSE 流式响应
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // 8. 流式生成并解析；重试时通知客户端清空失败草稿
        const llmOutput = await generateParsedWhatIf(
          system,
          user,
          8192,
          (delta) => send("delta", { text: delta }),
          () => send("reset", {}),
        );

        // 8.5 清理重复新增；原典校验始终基于不可变 base dataset
        const diff = normalizeDiffAgainstDataset(effectiveDataset, llmOutput.diff);
        const validation = validateNarrative(
          llmOutput.narrative,
          baseDataset,
          diff,
          priorTurns.map((turn) => turn.diff),
        );

        // 9. 落库新 turn
        // order 基于 branch 自己的 turns（不含 parent inherited），fork 后第一 turn order=1
        const nextOrder = ownTurns.length > 0
          ? ownTurns[ownTurns.length - 1].order + 1
          : 1;
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

        send("done", {
          turnId: newTurn.id,
          sessionId: session.id,
          branchId: branch.id,
          order: newTurn.order,
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
      "X-Accel-Buffering": "no",
    },
  });
}
