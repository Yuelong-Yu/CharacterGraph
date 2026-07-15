/**
 * WhatIf 功能的 Zod schema
 *
 * 与 prisma/schema.prisma 镜像，用于客户端校验和 API 输入校验。
 * GraphDiff / NarrativeSegment 是 LLM 输出格式，前后端共用。
 */
import { z } from "zod";
import { Character, Relation, Citation, CharacterEvent } from "./character";

// ─────────────────────────────────────────────────────────────
// GraphDiff - LLM 输出的图谱变化
// ─────────────────────────────────────────────────────────────
export const GraphDiff = z.object({
  removedNodes: z.array(z.string()),
  addedNodes: z.array(Character),
  removedEdges: z.array(z.string()),
  addedEdges: z.array(Relation),
  modifiedEvents: z.array(
    z.object({
      characterId: z.string(),
      eventIndex: z.number().int().min(0),
      newEvent: CharacterEvent,
    }),
  ),
  /** 替换某人物的全部 events（fork 场景常用：整个轨迹都变了） */
  replacedEvents: z
    .array(
      z.object({
        characterId: z.string(),
        newEvents: z.array(CharacterEvent),
      }),
    )
    .default([]),
});
export type GraphDiff = z.infer<typeof GraphDiff>;

// ─────────────────────────────────────────────────────────────
// NarrativeSegment - 带标注的叙事段
// ─────────────────────────────────────────────────────────────
export const NarrativeLabel = z.enum(["原典", "假设", "推演", "杜撰"]);
export type NarrativeLabel = z.infer<typeof NarrativeLabel>;

export const NarrativeSegment = z.object({
  text: z.string(),
  label: NarrativeLabel,
  citation: Citation.nullish(),
  characterIds: z.array(z.string()).default([]),
});
export type NarrativeSegment = z.infer<typeof NarrativeSegment>;

// ─────────────────────────────────────────────────────────────
// ValidationResult - 事后幻觉校验结果
// ─────────────────────────────────────────────────────────────
export const ValidationLevel = z.enum(["error", "warning"]);
export type ValidationLevel = z.infer<typeof ValidationLevel>;

export const ValidationResult = z.object({
  level: ValidationLevel,
  message: z.string(),
  segmentIndex: z.number().int().min(0).optional(),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

// ─────────────────────────────────────────────────────────────
// Turn / Branch / Session
// ─────────────────────────────────────────────────────────────
export const PremiseType = z.enum(["event_negative", "free_text"]);
export type PremiseType = z.infer<typeof PremiseType>;

export const TurnStatus = z.enum(["composing", "streaming", "completed", "error", "updating", "stale", "deleted"]);
export type TurnStatus = z.infer<typeof TurnStatus>;

export const SessionStatus = z.enum(["active", "archived"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const WhatIfTurnDetail = z.object({
  id: z.string(),
  branchId: z.string(),
  order: z.number().int().min(1),
  premise: z.string(),
  premiseType: PremiseType,
  sourceEventTitle: z.string().nullable(),
  diff: GraphDiff,
  narrative: z.array(NarrativeSegment),
  choices: z.array(z.string()),
  status: TurnStatus,
  validation: z.array(ValidationResult).nullable(),
  createdAt: z.date(),
});
export type WhatIfTurnDetail = z.infer<typeof WhatIfTurnDetail>;

export const WhatIfBranchDetail = z.object({
  id: z.string(),
  sessionId: z.string(),
  parentTurnId: z.string().nullable(),
  title: z.string(),
  isActive: z.boolean(),
  turns: z.array(WhatIfTurnDetail),
  createdAt: z.date(),
});
export type WhatIfBranchDetail = z.infer<typeof WhatIfBranchDetail>;

export const WhatIfSessionDetail = z.object({
  id: z.string(),
  projectSlug: z.string(),
  characterId: z.string(),
  title: z.string(),
  status: SessionStatus,
  branches: z.array(WhatIfBranchDetail),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type WhatIfSessionDetail = z.infer<typeof WhatIfSessionDetail>;

export const WhatIfSessionSummary = z.object({
  id: z.string(),
  projectSlug: z.string(),
  title: z.string(),
  status: SessionStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
  branchCount: z.number().int(),
  turnCount: z.number().int(),
});
export type WhatIfSessionSummary = z.infer<typeof WhatIfSessionSummary>;

// ─────────────────────────────────────────────────────────────
// API 请求 schema
// ─────────────────────────────────────────────────────────────

/** POST /api/whatif - 创建 session（Week 1 非流式占位，不调 LLM） */
export const CreateWhatIfSessionInput = z.object({
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  characterId: z.string().min(1),
  premise: z.string().min(1),
  premiseType: PremiseType,
  sourceEventTitle: z.string().nullish(),
  datasetOverlay: z.object({
    characters: z.array(Character),
    relations: z.array(Relation),
  }).optional(),
});
export type CreateWhatIfSessionInput = z.infer<typeof CreateWhatIfSessionInput>;

/** POST /api/whatif/[sessionId]/turns - 续写 turn */
export const ContinueTurnInput = z.object({
  userInput: z.string().min(1),
  datasetOverlay: z.object({
    characters: z.array(Character),
    relations: z.array(Relation),
  }).optional(),
});
export type ContinueTurnInput = z.infer<typeof ContinueTurnInput>;
