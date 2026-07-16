/**
 * GET    /api/whatif/[sessionId] - 拉取完整 session（含分支树 + turns）
 * DELETE /api/whatif/[sessionId] - 删除 session（级联删 branch + turn）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";
import { removeBranchImages } from "@/lib/server/branchImageAssets";
import { getSessionUserFromHeaders } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = getSessionUserFromHeaders(req.headers);
  if (!user) {
    return NextResponse.json({ error: "请先登录", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const { sessionId } = await params;
  const session = await prisma.whatIfSession.findFirst({
    where: { id: sessionId, ownerId: user.id },
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

  return NextResponse.json({
    session: {
      ...session,
      branches: session.branches.map((branch) => ({
        ...branch,
        turns: branch.turns.filter((turn) => turn.status !== "deleted"),
      })),
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = getSessionUserFromHeaders(req.headers);
  if (!user) {
    return NextResponse.json({ error: "请先登录", code: "LOGIN_REQUIRED" }, { status: 401 });
  }
  const { sessionId } = await params;
  const session = await prisma.whatIfSession.findFirst({
    where: { id: sessionId, ownerId: user.id },
    select: { projectSlug: true, branches: { select: { id: true } } },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const deleted = await prisma.whatIfSession.deleteMany({ where: { id: sessionId, ownerId: user.id } });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  await Promise.all(session.branches.map((branch) => (
    removeBranchImages(session.projectSlug, branch.id).catch((error) => {
      console.error(`清理分支图像失败 ${branch.id}:`, error);
    })
  )));
  return NextResponse.json({ ok: true });
}
