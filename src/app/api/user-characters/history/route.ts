import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/whatif/db";
import { loadDataset } from "@/lib/data";
import { mergeDatasetOverlay } from "@/lib/userCharacters";
import { affectedTurnIds } from "@/lib/whatif/historyImpact";
import { GraphDiff, NarrativeSegment } from "@/schemas/whatif";
import { Dataset as DatasetSchema } from "@/schemas/character";
import { applyDiff, normalizeDiffAgainstDataset } from "@/lib/whatif/diffApplier";
import { buildContext } from "@/lib/whatif/contextBuilder";
import {
  buildContinuationUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  type BranchPoint,
  type PriorTurnSummary,
} from "@/lib/whatif/promptBuilder";
import { generateParsedWhatIf } from "@/lib/whatif/llmClient";
import { validateNarrative } from "@/lib/whatif/validation";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DatasetOverlay = z.object({
  characters: DatasetSchema.shape.characters,
  relations: DatasetSchema.shape.relations,
});

const ActionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("regenerate"),
    projectSlug: z.string().min(1),
    branchId: z.string().min(1),
    characterId: z.string().min(1),
    datasetOverlay: DatasetOverlay,
  }),
  z.object({
    action: z.literal("delete"),
    projectSlug: z.string().min(1),
    branchId: z.string().min(1),
    characterId: z.string().min(1),
  }),
  z.object({
    action: z.literal("restore"),
    projectSlug: z.string().min(1),
    branchId: z.string().min(1),
    characterId: z.string().min(1),
    turnIds: z.array(z.string().min(1)),
  }),
]);

interface ParsedTurn {
  id: string;
  order: number;
  premise: string;
  premiseType: string;
  sourceEventTitle: string | null;
  diff: z.infer<typeof GraphDiff>;
  narrative: z.infer<typeof NarrativeSegment>[];
  choices: string[];
  validation: unknown;
  status: string;
}

function parseTurn(turn: {
  id: string;
  order: number;
  premise: string;
  premiseType: string;
  sourceEventTitle: string | null;
  diff: Prisma.JsonValue;
  narrative: Prisma.JsonValue;
  choices: Prisma.JsonValue;
  validation: Prisma.JsonValue | null;
  status: string;
}): ParsedTurn {
  return {
    ...turn,
    diff: GraphDiff.parse(turn.diff),
    narrative: z.array(NarrativeSegment).parse(turn.narrative),
    choices: z.array(z.string()).parse(turn.choices),
  };
}

async function loadBranch(branchId: string) {
  return prisma.whatIfBranch.findUnique({
    where: { id: branchId },
    include: {
      session: true,
      turns: { orderBy: { order: "asc" } },
    },
  });
}

function impactedIds(branch: NonNullable<Awaited<ReturnType<typeof loadBranch>>>, characterId: string): string[] {
  const turns = branch.turns.filter((turn) => turn.status !== "deleted").map(parseTurn);
  if (branch.session.characterId === characterId) return turns.map((turn) => turn.id);
  return affectedTurnIds(turns, characterId);
}

async function inheritedTurns(branch: NonNullable<Awaited<ReturnType<typeof loadBranch>>>): Promise<ParsedTurn[]> {
  if (!branch.parentTurnId) return [];
  const parentTurn = await prisma.whatIfTurn.findUnique({ where: { id: branch.parentTurnId } });
  if (!parentTurn) return [];
  const parentBranch = await loadBranch(parentTurn.branchId);
  if (!parentBranch) return [];
  const ancestors = await inheritedTurns(parentBranch);
  const parentOwn = parentBranch.turns
    .filter((turn) => turn.status !== "deleted" && turn.order <= parentTurn.order)
    .map(parseTurn);
  return [...ancestors, ...parentOwn];
}

export async function GET(req: NextRequest) {
  const branchId = req.nextUrl.searchParams.get("branchId");
  const characterId = req.nextUrl.searchParams.get("characterId");
  if (!branchId || !characterId) {
    return NextResponse.json({ error: "branchId and characterId are required" }, { status: 400 });
  }
  const branch = await loadBranch(branchId);
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const turnIds = impactedIds(branch, characterId);
  return NextResponse.json({ count: turnIds.length, turnIds });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ActionInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const branch = await loadBranch(input.branchId);
  if (!branch || branch.session.projectSlug !== input.projectSlug) {
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }

  if (input.action === "restore") {
    await prisma.whatIfTurn.updateMany({
      where: { branchId: input.branchId, id: { in: input.turnIds }, status: "deleted" },
      data: { status: "completed" },
    });
    return NextResponse.json({ restored: input.turnIds.length });
  }

  const turnIds = impactedIds(branch, input.characterId);
  if (input.action === "delete") {
    await prisma.whatIfTurn.updateMany({
      where: { branchId: input.branchId, id: { in: turnIds } },
      data: { status: "deleted" },
    });
    return NextResponse.json({ deleted: turnIds.length, turnIds });
  }

  await prisma.whatIfBranch.update({
    where: { id: branch.id },
    data: { datasetOverlay: input.datasetOverlay as unknown as Prisma.InputJsonValue },
  });
  if (turnIds.length === 0) return NextResponse.json({ regenerated: 0, turnIds: [] });

  const loaded = loadDataset(input.projectSlug);
  const baseDataset = mergeDatasetOverlay(loaded.dataset, input.datasetOverlay);
  const canonicalSubset = buildContext(baseDataset, branch.session.characterId);
  const inherited = await inheritedTurns(branch);
  const ownTurns = branch.turns.filter((turn) => turn.status !== "deleted").map(parseTurn);
  const firstAffectedIndex = ownTurns.findIndex((turn) => turn.id === turnIds[0]);
  const preservedOwn = ownTurns.slice(0, firstAffectedIndex);
  const regenerated: ParsedTurn[] = [];

  await prisma.whatIfTurn.updateMany({
    where: { id: { in: turnIds } },
    data: { status: "updating" },
  });

  for (let index = firstAffectedIndex; index < ownTurns.length; index += 1) {
    const current = ownTurns[index];
    const priorTurns = [...inherited, ...preservedOwn, ...regenerated];
    const effectiveDataset = priorTurns.reduce((currentDataset, turn) => applyDiff(currentDataset, turn.diff), baseDataset);
    try {
      const subset = buildContext(effectiveDataset, branch.session.characterId);
      const system = buildSystemPrompt(canonicalSubset, loaded.config, {
        branchSubset: subset,
        knownCharacters: effectiveDataset.characters.map(({ id, name_zh }) => ({ id, name_zh })),
      });
      const root = priorTurns[0] ?? current;
      const branchPoint: BranchPoint = {
        characterId: branch.session.characterId,
        characterName: subset.core.name_zh,
        eventTitle: root.sourceEventTitle,
        premise: root.premise,
        premiseType: root.premiseType as BranchPoint["premiseType"],
      };
      const user = priorTurns.length === 0
        ? buildUserPrompt(branchPoint)
        : buildContinuationUserPrompt(
            branchPoint,
            priorTurns.map<PriorTurnSummary>((turn) => ({
              premise: turn.premise,
              narrative: turn.narrative.map((segment) => ({ label: segment.label, text: segment.text })),
            })),
            current.premise,
          );
      const output = await generateParsedWhatIf(system, user, 8192, () => {}, () => {});
      const diff = normalizeDiffAgainstDataset(effectiveDataset, output.diff);
      const validation = validateNarrative(output.narrative, baseDataset, diff, priorTurns.map((turn) => turn.diff));
      const latestVersion = await prisma.whatIfTurnVersion.aggregate({
        where: { turnId: current.id },
        _max: { version: true },
      });
      await prisma.$transaction(async (transaction) => {
        await transaction.whatIfTurnVersion.create({
          data: {
            turnId: current.id,
            version: (latestVersion._max.version ?? 0) + 1,
            diff: current.diff as unknown as Prisma.InputJsonValue,
            narrative: current.narrative as unknown as Prisma.InputJsonValue,
            choices: current.choices,
            validation: current.validation as Prisma.InputJsonValue | undefined,
          },
        });
        await transaction.whatIfTurn.update({
          where: { id: current.id },
          data: {
            diff: diff as unknown as Prisma.InputJsonValue,
            narrative: output.narrative as unknown as Prisma.InputJsonValue,
            choices: output.choices,
            validation: validation as unknown as Prisma.InputJsonValue,
            status: "completed",
          },
        });
      });
      const versions = await prisma.whatIfTurnVersion.findMany({
        where: { turnId: current.id },
        orderBy: { createdAt: "desc" },
        skip: 5,
        select: { id: true },
      });
      if (versions.length > 0) {
        await prisma.whatIfTurnVersion.deleteMany({ where: { id: { in: versions.map((version) => version.id) } } });
      }
      regenerated.push({ ...current, diff, narrative: output.narrative, choices: output.choices, validation, status: "completed" });
    } catch (error) {
      const remainingIds = ownTurns.slice(index).map((turn) => turn.id);
      await prisma.whatIfTurn.updateMany({
        where: { id: { in: remainingIds } },
        data: { status: "stale" },
      });
      return NextResponse.json({
        error: error instanceof Error ? error.message : String(error),
        regenerated: regenerated.length,
        staleTurnIds: remainingIds,
      }, { status: 502 });
    }
  }

  return NextResponse.json({ regenerated: regenerated.length, turnIds });
}
