/**
 * 幻觉校验（事后扫描）
 *
 * 两层校验：
 *   1. 人名校验：叙事中提取人名（用名册 name_zh + aliases 子串匹配），
 *      检查【原典】段提到的人物是否在原数据中存在且有对应 event。
 *   2. 原典引用校验：【原典】段的 citation.work 必须在原数据的 Citation 集合中存在。
 *
 * 校验结果存在 WhatIfTurn.validation 字段，UI 用颜色标识。
 *
 * 注意：中文人名提取用子串匹配（非分词），可能有噪声（如「宋江」匹配「宋江南」），
 * 但原典校验只看【原典】段，相对可控。
 */
import type { Dataset } from "@/schemas/character";
import type { GraphDiff, NarrativeSegment, ValidationResult } from "@/schemas/whatif";

/**
 * 构建人名索引：name_zh + aliases -> characterId
 * 用于叙事文本中的人名子串匹配。
 */
function buildNameIndex(dataset: Dataset, addedNodes: GraphDiff["addedNodes"]): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of dataset.characters) {
    index.set(c.name_zh, c.id);
    for (const alias of c.aliases) {
      if (alias.length >= 2) index.set(alias, c.id);  // 跳过单字符别名（噪声大）
    }
  }
  for (const c of addedNodes) {
    index.set(c.name_zh, c.id);
    for (const alias of c.aliases) {
      if (alias.length >= 2) index.set(alias, c.id);
    }
  }
  return index;
}

/**
 * 构建原典 work 集合：原数据所有 events/quotes 的 source.work
 */
function buildCanonWorks(dataset: Dataset): Set<string> {
  const works = new Set<string>();
  for (const c of dataset.characters) {
    for (const e of c.events) {
      if (e.source?.work) works.add(e.source.work);
    }
    for (const q of c.quotes) {
      if (q.source?.work) works.add(q.source.work);
    }
  }
  for (const a of dataset.artifacts) {
    for (const e of a.events) {
      if (e.source?.work) works.add(e.source.work);
    }
  }
  for (const r of dataset.relations) {
    for (const e of r.events) {
      if (e.source?.work) works.add(e.source.work);
    }
  }
  return works;
}

/**
 * 在文本中查找所有人名出现。
 * 返回 characterId 集合（去重）。
 */
function findMentionedCharacters(text: string, nameIndex: Map<string, string>): Set<string> {
  const mentioned = new Set<string>();
  for (const [name, id] of nameIndex) {
    if (text.includes(name)) {
      mentioned.add(id);
    }
  }
  return mentioned;
}

/**
 * 校验叙事段。
 *
 * @param narrative LLM 输出的叙事段数组
 * @param baseDataset 原始图谱数据
 * @param diff 本次 turn 的 diff（含 addedNodes）
 * @param priorDiffs 当前分支此前所有 turn 的 diff，用于追踪历史新增人物
 * @returns ValidationResult[] 校验结果
 */
export function validateNarrative(
  narrative: NarrativeSegment[],
  baseDataset: Dataset,
  diff: GraphDiff,
  priorDiffs: GraphDiff[] = [],
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const branchAddedNodes = [
    ...priorDiffs.flatMap((priorDiff) => priorDiff.addedNodes),
    ...diff.addedNodes,
  ];
  const branchAddedIds = new Set(branchAddedNodes.map((node) => node.id));
  const nameIndex = buildNameIndex(baseDataset, branchAddedNodes);
  const canonWorks = buildCanonWorks(baseDataset);

  for (let i = 0; i < narrative.length; i++) {
    const seg = narrative[i];

    // 校验 1: 【原典】段的 citation.work 必须在原数据中存在
    if (seg.label === "原典" && seg.citation?.work) {
      if (!canonWorks.has(seg.citation.work)) {
        results.push({
          level: "error",
          message: `【原典】段引用的出处「${seg.citation.work}」不在原数据中，可能是 LLM 杜撰`,
          segmentIndex: i,
        });
      }
    }

    // 校验 2: 【原典】段提到的人物必须在原数据中存在（不能是 addedNodes 里的新人物）
    if (seg.label === "原典") {
      const mentioned = findMentionedCharacters(seg.text, nameIndex);
      for (const charId of mentioned) {
        // 当前分支任意 turn 新增的人物都不能成为原典人物
        const isNew = branchAddedIds.has(charId);
        if (isNew) {
          const newChar = branchAddedNodes.find((n) => n.id === charId);
          results.push({
            level: "error",
            message: `【原典】段提到了「${newChar?.name_zh}」，但这是当前分支新增的人物，只能作为【假设】内容`,
            segmentIndex: i,
          });
        }
      }
    }

    // 校验 3: 【推演】段不应直接引用具体出处
    if (seg.label === "推演" && seg.citation?.work) {
      results.push({
        level: "warning",
        message: `【推演】段带了出处「${seg.citation.work}」，推演内容不应有原典引用`,
        segmentIndex: i,
      });
    }
  }

  return results;
}
