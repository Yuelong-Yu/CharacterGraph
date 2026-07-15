import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/whatif/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findSessionTurn(sessionId: string, turnId: string) {
  const turn = await prisma.whatIfTurn.findUnique({
    where: { id: turnId },
    include: { branch: { select: { sessionId: true } } },
  });
  return turn?.branch.sessionId === sessionId ? turn : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; turnId: string }> },
) {
  const { sessionId, turnId } = await params;
  if (!await findSessionTurn(sessionId, turnId)) {
    return NextResponse.json({ error: "Turn not found" }, { status: 404 });
  }
  const versions = await prisma.whatIfTurnVersion.findMany({
    where: { turnId },
    orderBy: { createdAt: "desc" },
    select: { id: true, version: true, createdAt: true },
  });
  return NextResponse.json({ versions });
}

const RestoreInput = z.object({ versionId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; turnId: string }> },
) {
  const { sessionId, turnId } = await params;
  const turn = await findSessionTurn(sessionId, turnId);
  if (!turn) return NextResponse.json({ error: "Turn not found" }, { status: 404 });
  const input = RestoreInput.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: input.error.flatten() }, { status: 400 });
  const selected = await prisma.whatIfTurnVersion.findFirst({
    where: { id: input.data.versionId, turnId },
  });
  if (!selected) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const latest = await prisma.whatIfTurnVersion.aggregate({
    where: { turnId },
    _max: { version: true },
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.whatIfTurnVersion.create({
      data: {
        turnId,
        version: (latest._max.version ?? 0) + 1,
        diff: turn.diff as Prisma.InputJsonValue,
        narrative: turn.narrative as Prisma.InputJsonValue,
        choices: turn.choices as Prisma.InputJsonValue,
        validation: turn.validation as Prisma.InputJsonValue | undefined,
      },
    });
    await transaction.whatIfTurn.update({
      where: { id: turnId },
      data: {
        diff: selected.diff as Prisma.InputJsonValue,
        narrative: selected.narrative as Prisma.InputJsonValue,
        choices: selected.choices as Prisma.InputJsonValue,
        validation: selected.validation as Prisma.InputJsonValue | undefined,
        status: "completed",
      },
    });
  });

  const obsolete = await prisma.whatIfTurnVersion.findMany({
    where: { turnId },
    orderBy: { createdAt: "desc" },
    skip: 5,
    select: { id: true },
  });
  if (obsolete.length > 0) {
    await prisma.whatIfTurnVersion.deleteMany({ where: { id: { in: obsolete.map((version) => version.id) } } });
  }
  return NextResponse.json({ restored: true });
}
