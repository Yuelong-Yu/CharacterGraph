import {
  GeneratedProfile,
  GeneratedRelationshipBatch,
  GeneratedTargetSelection,
  type GeneratedRelationship,
} from "@/schemas/userCharacter";

export class UserCharacterGenerationError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
    this.name = "UserCharacterGenerationError";
  }
}

export const USER_CHARACTER_OUTPUT_TOKEN_LIMIT = 100_000;

export function targetSelectionTokenBudget(remainingCount: number): number {
  void remainingCount;
  return USER_CHARACTER_OUTPUT_TOKEN_LIMIT;
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new UserCharacterGenerationError("模型响应中没有 JSON 对象", raw);
  }
  try {
    return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    throw new UserCharacterGenerationError(
      `模型响应不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      raw,
    );
  }
}

export function parseGeneratedProfile(raw: string) {
  const parsed = GeneratedProfile.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new UserCharacterGenerationError(`人物资料不符合约定：${parsed.error.message}`, raw);
  }
  return parsed.data;
}

export function parseGeneratedTargetIds(
  raw: string,
  allowedIds: ReadonlySet<string>,
  expectedCount: number,
): string[] {
  const parsed = GeneratedTargetSelection.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new UserCharacterGenerationError(`关系对象列表不符合约定：${parsed.error.message}`, raw);
  }
  const unique = Array.from(new Set(parsed.data.targetIds));
  if (unique.length !== expectedCount) {
    throw new UserCharacterGenerationError(`关系对象数量不正确：期望 ${expectedCount}，实际 ${unique.length}`, raw);
  }
  const unknown = unique.find((id) => !allowedIds.has(id));
  if (unknown) throw new UserCharacterGenerationError(`模型选择了未知人物：${unknown}`, raw);
  return unique;
}

export function parseGeneratedRelationships(
  raw: string,
  expectedTargetIds: ReadonlySet<string>,
  allowedRelationTypes: ReadonlySet<string>,
): GeneratedRelationship[] {
  const parsed = GeneratedRelationshipBatch.safeParse(extractJson(raw));
  if (!parsed.success) {
    throw new UserCharacterGenerationError(`关系故事不符合约定：${parsed.error.message}`, raw);
  }
  const targets = new Set(parsed.data.relationships.map((relationship) => relationship.targetId));
  if (targets.size !== expectedTargetIds.size || parsed.data.relationships.length !== expectedTargetIds.size) {
    throw new UserCharacterGenerationError(
      `关系对象数量不正确：期望 ${expectedTargetIds.size}，实际 ${targets.size}`,
      raw,
    );
  }
  for (const relationship of parsed.data.relationships) {
    if (!expectedTargetIds.has(relationship.targetId)) {
      throw new UserCharacterGenerationError(`模型生成了未请求的关系对象：${relationship.targetId}`, raw);
    }
    if (!allowedRelationTypes.has(relationship.primaryType)) {
      throw new UserCharacterGenerationError(`模型生成了未知关系类型：${relationship.primaryType}`, raw);
    }
    const invalidComposite = relationship.compositeTypes.find((type) => !allowedRelationTypes.has(type));
    if (invalidComposite) {
      throw new UserCharacterGenerationError(`模型生成了未知次要关系类型：${invalidComposite}`, raw);
    }
  }
  return parsed.data.relationships;
}
