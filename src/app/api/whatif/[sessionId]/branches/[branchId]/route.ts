/**
 * PATCH /api/whatif/[sessionId]/branches/[branchId] - 切换 active branch
 *
 * 把目标 branch 设为 active，同 session 其他 branch 取消 active。
 * 返回更新后的完整 session（含所有 branches + turns）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";
import { getSessionUserFromHeaders } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; branchId: string }> },
) {
  const user = getSessionUserFromHeaders(req.headers);
  if (!user) {
    return NextResponse.json({ error: "请先登录后切换分支", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const { sessionId, branchId } = await params;

  // 验证 branch 属于该 session
  const branch = await prisma.whatIfBranch.findFirst({
    where: { id: branchId, sessionId, session: { ownerId: user.id } },
  });
  if (!branch) {
    return NextResponse.json(
      { error: `Branch ${branchId} not found in session ${sessionId}` },
      { status: 404 },
    );
  }

  // 事务：取消其他 active + 设目标为 active
  await prisma.$transaction([
    prisma.whatIfBranch.updateMany({
      where: { sessionId },
      data: { isActive: false },
    }),
    prisma.whatIfBranch.update({
      where: { id: branchId },
      data: { isActive: true },
    }),
  ]);

  // 返回完整 session
  const session = await prisma.whatIfSession.findFirst({
    where: { id: sessionId, ownerId: user.id },
    include: {
      branches: {
        orderBy: { createdAt: "asc" },
        include: { turns: { orderBy: { order: "asc" } } },
      },
    },
  });

  return NextResponse.json({ session });
}
