/**
 * POST /api/whatif/[sessionId]/branches - 从某 turn fork 新分支
 *
 * 输入: { parentTurnId: string, title?: string }
 *
 * 行为:
 *   1. 找到 parentTurnId 所属的 branch（可能在任意 branch 上）
 *   2. 创建新 branch，parentTurnId 指向 fork 源 turn
 *   3. 把新 branch 设为 active，同 session 其他 branch 取消 active
 *   4. 返回新 branch（无 turns，等用户续写第一 turn）
 *
 * 新 branch 的第一 turn 由后续 POST /api/whatif/[sessionId]/turns 生成，
 * 该 API 会自动把 parentTurn 所在 branch 中 order ≤ parentTurnId 的 turns 当作 prior。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ForkInput = z.object({
  parentTurnId: z.string().min(1),
  title: z.string().min(1).optional(),
});

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

  const parsed = ForkInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // 验证 session 存在
  const session = await prisma.whatIfSession.findUnique({
    where: { id: sessionId },
    include: { branches: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // 找 parentTurn（在任意 branch 上）
  let parentTurn = null;
  for (const b of session.branches) {
    const t = await prisma.whatIfTurn.findUnique({
      where: { id: input.parentTurnId },
    });
    if (t && t.branchId === b.id) {
      parentTurn = t;
      break;
    }
  }
  if (!parentTurn) {
    return NextResponse.json(
      { error: `Turn ${input.parentTurnId} not found in session ${sessionId}` },
      { status: 404 },
    );
  }

  // 用事务：取消其他 branch 的 active + 创建新 branch
  const newBranch = await prisma.$transaction(async (tx) => {
    await tx.whatIfBranch.updateMany({
      where: { sessionId },
      data: { isActive: false },
    });
    return tx.whatIfBranch.create({
      data: {
        sessionId,
        parentTurnId: input.parentTurnId,
        title: input.title ?? `分叉自 turn ${parentTurn.order}`,
        isActive: true,
      },
    });
  });

  return NextResponse.json({ branch: newBranch }, { status: 201 });
}
