/**
 * GET    /api/whatif/[sessionId] - 拉取完整 session（含分支树 + turns）
 * DELETE /api/whatif/[sessionId] - 删除 session（级联删 branch + turn）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/whatif/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
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
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  try {
    await prisma.whatIfSession.delete({ where: { id: sessionId } });
  } catch {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
