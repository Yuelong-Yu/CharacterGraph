/**
 * Prompt 组装 + LLM 输出解析
 *
 * 输出格式（用 === 分隔，避免 markdown 围栏干扰）：
 *
 *   ===DIFF===
 *   {JSON}
 *   ===NARRATIVE===
 *   【原典】...
 *   【假设】...
 *   【推演】...
 *   【杜撰】...
 *   ===CHOICES===
 *   1. ...
 *   2. ...
 *   3. ...
 *
 * 解析失败时抛 ParseError，调用方决定降级策略。
 */
import type { ClientProjectConfig } from "@/schemas/projectConfig";
import { GraphDiff, NarrativeSegment, NarrativeLabel } from "@/schemas/whatif";
import type { GraphSubset } from "./contextBuilder";
import { formatSubsetForPrompt } from "./contextBuilder";

export interface BranchPoint {
  characterId: string;
  characterName: string;
  eventTitle: string | null; // null = free_text premise
  premise: string;
  premiseType: "event_negative" | "free_text";
}

export interface SystemPromptOptions {
  /** 重放历史 diff 后的分支状态；只作为假设上下文，不能作为原典证据。 */
  branchSubset?: GraphSubset;
  /** 完整项目中的已有角色简表，用来避免 LLM 重复新增已有角色。 */
  knownCharacters?: Array<{ id: string; name_zh: string }>;
}

/**
 * 构建 system prompt：角色定义 + 图谱子集 + 标注规则 + 输出格式 + 合法 category/relationType 清单
 */
export function buildSystemPrompt(
  canonicalSubset: GraphSubset,
  config: ClientProjectConfig,
  options: SystemPromptOptions = {},
): string {
  const charCategories = Object.keys(config.characterCategories).join("、");
  const relTypes = Object.keys(config.relationTypes).join("、");
  const branchState = options.branchSubset
    ? formatSubsetForPrompt(options.branchSubset)
    : "（首轮推演，尚无历史分支状态）";
  const knownCharacters = options.knownCharacters?.length
    ? options.knownCharacters.map((c) => `${c.id}:${c.name_zh}`).join("、")
    : "（仅使用下方图谱子集中的人物）";

  return `你是一个严谨的架空历史推演系统，专门用于文学/历史题材的人物关系图谱「如果」假设叙事生成。

# 你的任务
基于给定的人物图谱子集和分支点前提，推演「如果这件事没发生（或前提成立）」之后的故事走向，输出三部分：
1. 图谱变化（哪些人物/关系消失或新增、哪些事件被改写）
2. 带标注的叙事（每段必须标【原典】/【假设】/【推演】/【杜撰】）
3. 2-3 个后续走向选项

# 不可变原典图谱子集
${formatSubsetForPrompt(canonicalSubset)}

# 当前分支状态（假设）
${branchState}

# 已存在人物索引
${knownCharacters}

# 标注规则（严格遵守）
每段叙事开头必须加标签：
- 【原典】完全基于原著/史实的内容，未做任何推演。只有不可变原典图谱子集中的 events/bio 才能作为原典依据。
- 【假设】用户输入的分支前提，或前几轮已经在当前分支成立的内容。即使它出现在“当前分支状态”的 events/bio 中，也绝不能标成原典。
- 【推演】本轮基于原典和假设进行的合理推导，虽未发生但符合人物性格和背景。
- 【杜撰】完全创造性内容，用于填补叙事空白或推进情节。

# 合法取值约束（违反则输出无效）
- 新增人物的 category 必须是其中之一：${charCategories}
- addedNodes 只能包含“已存在人物索引”中没有的新人物；已有角色不得重复新增。
- 新增 relation 的 primary_type 必须是其中之一：${relTypes}
- 新增人物 id 必须匹配 ^[a-z][a-z0-9_]*$（拼音 slug，如 zhang_wenyuan）
- 新增 relation 的 id 必须是 source/target 按字典序用 - 连接（如 a-b，a 字典序小于 b）
- DIFF 中所有新增或改写事件的 source.work 必须写成对应的“著作名-改编”，不要带《》；例如“水浒传-改编”“伊利亚特-改编”，绝不能直接写原著名。

# 输出格式（严格遵守，用 === 分隔，不要加 markdown 围栏）
===DIFF===
{
  "removedNodes": ["character_id"],
  "addedNodes": [
    {
      "schema_version": 3,
      "id": "slug",
      "name_zh": "中文名",
      "name_en": "English Name",
      "aliases": [],
      "epithet": "绰号或 null",
      "category": "合法分类",
      "era_layer": 1,
      "bio": "人物简介",
      "events": [],
      "quotes": [],
      "weapons": [],
      "skills": [],
      "domains": [],
      "mounts": [],
      "portrait": "",
      "thumb": ""
    }
  ],
  "removedEdges": ["source-target"],
  "addedEdges": [
    {
      "schema_version": 3,
      "id": "a-b",
      "source": "a",
      "target": "b",
      "primary_type": "合法关系类型",
      "composite_types": [],
      "events": []
    }
  ],
  "modifiedEvents": [
    {"characterId": "id", "eventIndex": 0, "newEvent": {"title": "...", "desc": "...", "source": {"work": "著作名-改编", "locus": null, "translator": null}}}
  ],
  "replacedEvents": []
}
===NARRATIVE===
【原典】第一段叙事...
【假设】已经成立的分支前提或前情...
【推演】本轮合理推导...
【杜撰】本轮创造性补充...
===CHOICES===
1. 选项一描述
2. 选项二描述
3. 选项三描述

# 图谱变化原则（严格遵守，避免过度激进）
**核心原则：局部影响。** 一个事件的改变通常只影响直接相关的人物，不应连锁删除远亲节点。

1. **removedNodes 极度克制**：
   - 只删除「因前提改变而必然不存在」的人物（如：前提是宋江没上梁山，那么只在梁山聚义后才出现的人物可考虑删除）。
   - **绝不删除 2 度以上的远亲节点**。如无直接因果链，保留。
   - 一次 turn 的 removedNodes 通常 ≤ 5 个，超过 10 个几乎肯定是过度激进。

2. **优先 modifiedEvents 而非 removedNodes**：
   - 人物还在，但他的某个事件改变了 -> 用 modifiedEvents 改写事件 desc。
   - 只有当人物因前提而「根本不可能存在于这个故事中」时才用 removedNodes。

3. **removedEdges 同样克制**：
   - 只删除「因前提改变而必然断裂」的关系。
   - 两人即使不再有某个具体事件，他们的基本关系（如亲属、师徒）通常仍存在。
   - 人物暂时离开、换地点、当前场景没有互动，都不代表关系断裂，绝不能因此删除边。
   - 只有本轮叙事明确写出双方决裂、绝交或断绝关系时，才可删除两个仍存在人物之间的边。

4. **addedNodes/addedEdges 鼓励**：
   - 如果前提引入了“已存在人物索引”中没有的新人物，可新增。
   - 新人物必须有合理的 bio 和 category。

5. **replacedEvents 用于 fork 续写**：
   - 当整个时间线大幅偏离原典时，可用 replacedEvents 替换某人物的全部 events。
   - 首次推演尽量不用，优先用 modifiedEvents 局部改写。

# 重要约束
- 首轮叙事至少包含 1 段【原典】、1 段【假设】和 1 段【推演】；续写若回顾前情必须标【假设】，不得为了凑段落把假设改标为【原典】。
- choices 必须是 2-3 个，每个一行，用 "数字. " 开头。
- 不要输出 === 分隔符以外的任何解释性文字。
- **再次强调：removedNodes 要极度克制，不要因为「连锁影响」就删除大量远亲节点。**`;
}

/**
 * 构建 user prompt：分支点信息 + premise（首次生成）
 */
export function buildUserPrompt(branchPoint: BranchPoint): string {
  const eventLine = branchPoint.eventTitle
    ? `触发事件: ${branchPoint.eventTitle}`
    : `触发事件: (无特定事件，自由前提)`;

  return `请基于以下分支点推演：

分支人物: ${branchPoint.characterName}（id: ${branchPoint.characterId}）
${eventLine}
前提假设: ${branchPoint.premise}
前提类型: ${branchPoint.premiseType === "event_negative" ? "否定该事件（这件事没发生）" : "自由文本前提"}

按 system prompt 规定的格式输出。`;
}

/**
 * 构建续写 user prompt：包含前文叙事摘要 + 用户选择/新前提
 *
 * priorTurns 是已完成的 turn 列表（按 order 升序），每项包含 premise + narrative + 用户当时的选择。
 * userInput 是用户本轮的选择（来自上一 turn 的 choices 之一）或自由输入。
 */
export interface PriorTurnSummary {
  premise: string;
  narrative: { label: string; text: string }[];
  userChoice?: string; // 上一 turn 用户选了啥（首个 turn 没有）
}

export function buildContinuationUserPrompt(
  branchPoint: BranchPoint,
  priorTurns: PriorTurnSummary[],
  userInput: string,
): string {
  const historyBlock = priorTurns
    .map((t, i) => {
      const turnHeader = `第 ${i + 1} turn`;
      const premiseLine = `前提: ${t.premise}`;
      const choiceLine = t.userChoice ? `用户选择: ${t.userChoice}` : "(首轮，无前序选择)";
      const narrativeLines = t.narrative
        // 历史段落进入下一轮后都是分支既成信息；原典证据只从 canonicalSubset 获取。
        .map((n) => `【假设】${n.text}`)
        .join("\n");
      return `${turnHeader}\n${premiseLine}\n${choiceLine}\n${narrativeLines}`;
    })
    .join("\n\n---\n\n");

  return `这是续写。分支人物仍是 ${branchPoint.characterName}（id: ${branchPoint.characterId}）。

# 前文摘要
${historyBlock}

# 本轮用户输入
${userInput}

# 要求
基于前文和当前图谱状态，继续推演下一 turn。
- 输出格式同 system prompt 规定（===DIFF=== / ===NARRATIVE=== / ===CHOICES===）
- diff 是相对**当前图谱状态**的增量（不是相对原始图谱）
- 前文中的【假设】是当前分支已成立的事实，但仍不是原典
- 叙事要承接前文，不要重复已发生的事
- 至少 2 段叙事，至少 1 段【推演】
- 2-3 个后续选项`;
}

// ─────────────────────────────────────────────────────────────
// 输出解析
// ─────────────────────────────────────────────────────────────

export class LLMParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "LLMParseError";
  }
}

export interface ParsedLLMOutput {
  diff: GraphDiff;
  narrative: NarrativeSegment[];
  choices: string[];
}

const SEPARATOR_DIFF = "===DIFF===";
const SEPARATOR_NARRATIVE = "===NARRATIVE===";
const SEPARATOR_CHOICES = "===CHOICES===";

/**
 * 解析 LLM 输出。失败时抛 LLMParseError（带 raw 原文便于调试）。
 */
export function parseLLMOutput(raw: string): ParsedLLMOutput {
  const text = raw.trim();

  // 定位三个分隔符
  const diffStart = text.indexOf(SEPARATOR_DIFF);
  const narrativeStart = text.indexOf(SEPARATOR_NARRATIVE);
  const choicesStart = text.indexOf(SEPARATOR_CHOICES);

  // 容错：如果 LLM 没用分隔符，尝试启发式解析
  if (diffStart < 0 || narrativeStart < 0 || choicesStart < 0) {
    return parseLenient(text);
  }

  const diffBlock = text
    .slice(diffStart + SEPARATOR_DIFF.length, narrativeStart)
    .trim();
  const narrativeBlock = text
    .slice(narrativeStart + SEPARATOR_NARRATIVE.length, choicesStart)
    .trim();
  const choicesBlock = text.slice(choicesStart + SEPARATOR_CHOICES.length).trim();

  const diff = parseDiffBlock(diffBlock, raw);
  const narrative = parseNarrativeBlock(narrativeBlock, raw);
  const choices = parseChoicesBlock(choicesBlock, raw);

  return { diff, narrative, choices };
}

function parseDiffBlock(block: string, raw: string): GraphDiff {
  // 去 ```json 围栏（LLM 偶尔会加）
  let cleaned = block.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // 尝试从第一个 { 到最后一个 } 切片
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        throw new LLMParseError("DIFF 块不是合法 JSON", raw);
      }
    } else {
      throw new LLMParseError("DIFF 块不是合法 JSON", raw);
    }
  }

  // 修正 LLM 常见失误：
  // 1. source.work = null（"未发生" 事件）-> source = null
  // 2. composite_types = null -> []
  // 3. aliases/events/quotes 等数组字段 = null -> []
  sanitizeDiffJson(parsed);

  const result = GraphDiff.safeParse(parsed);
  if (!result.success) {
    throw new LLMParseError(
      `DIFF 块 Zod 校验失败: ${JSON.stringify(result.error.flatten())}`,
      raw,
    );
  }
  return result.data;
}

/**
 * 修正 LLM 常见输出失误，让 Zod 校验更容易通过。
 * 直接 mutate parsed 对象。
 */
function sanitizeDiffJson(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object") return;
  const diff = parsed as Record<string, unknown>;

  // addedNodes: 修正 Character 对象 + 过滤缺必填字段的
  if (Array.isArray(diff.addedNodes)) {
    const validNodes: unknown[] = [];
    for (const n of diff.addedNodes) {
      if (n && typeof n === "object") {
        const node = n as Record<string, unknown>;
        sanitizeCharacter(node);
        // 过滤掉缺 id/name_zh/category 的无效 node
        if (hasRequiredCharacterFields(node)) {
          validNodes.push(node);
        }
      }
    }
    diff.addedNodes = validNodes;
  }

  // addedEdges: 修正 Relation 对象 + 过滤缺必填字段的
  if (Array.isArray(diff.addedEdges)) {
    const validEdges: unknown[] = [];
    for (const r of diff.addedEdges) {
      if (r && typeof r === "object") {
        const rel = r as Record<string, unknown>;
        // 必填字段补默认
        if (rel.schema_version == null) rel.schema_version = 3;
        if (rel.composite_types == null) rel.composite_types = [];
        if (rel.events == null) rel.events = [];

        // 校验不可补的必填字段
        const hasId = typeof rel.id === "string" && rel.id.length > 0;
        const hasSource = typeof rel.source === "string" && rel.source.length > 0;
        const hasTarget = typeof rel.target === "string" && rel.target.length > 0;
        const hasType = typeof rel.primary_type === "string" && /^[a-z][a-z0-9_]*$/.test(rel.primary_type);
        if (hasId && hasSource && hasTarget && hasType) {
          if (Array.isArray(rel.events)) {
            for (const e of rel.events) {
              if (e && typeof e === "object") {
                const ev = e as Record<string, unknown>;
                if (ev.era_order == null) ev.era_order = 0;
                sanitizeEventSource(ev);
              }
            }
          }
          validEdges.push(rel);
        }
      }
    }
    diff.addedEdges = validEdges;
  }

  // modifiedEvents: 修正 newEvent + 过滤无效 eventIndex + 处理 array newEvent
  if (Array.isArray(diff.modifiedEvents)) {
    const validMods: unknown[] = [];
    const replacedEvents: Array<{ characterId: string; newEvents: unknown[] }> = [];

    for (const m of diff.modifiedEvents) {
      if (m && typeof m === "object") {
        const mod = m as Record<string, unknown>;

        // LLM 偶尔把 newEvent 写成数组（意图是"替换全部 events"）
        // 移到 replacedEvents 字段
        if (Array.isArray(mod.newEvent)) {
          replacedEvents.push({
            characterId: String(mod.characterId ?? ""),
            newEvents: mod.newEvent,
          });
          continue;
        }

        // eventIndex 必须是非负整数，否则跳过
        const idx = typeof mod.eventIndex === "number" ? mod.eventIndex : Number(mod.eventIndex);
        if (!Number.isFinite(idx) || idx < 0 || !Number.isInteger(idx)) {
          continue;
        }
        mod.eventIndex = idx;
        if (mod.newEvent && typeof mod.newEvent === "object") {
          sanitizeEventSource(mod.newEvent as Record<string, unknown>);
        }
        validMods.push(mod);
      }
    }
    diff.modifiedEvents = validMods;

    // 合并已有的 replacedEvents（LLM 可能直接输出 replacedEvents 字段）
    if (replacedEvents.length > 0) {
      const existing = Array.isArray(diff.replacedEvents) ? diff.replacedEvents : [];
      diff.replacedEvents = [...existing, ...replacedEvents];
    }
  }

  // replacedEvents: 修正 newEvents 内每个 event 的 source
  if (Array.isArray(diff.replacedEvents)) {
    for (const r of diff.replacedEvents) {
      if (r && typeof r === "object") {
        const rep = r as Record<string, unknown>;
        if (!Array.isArray(rep.newEvents) && Array.isArray(rep.replacedEvents)) {
          rep.newEvents = rep.replacedEvents;
          delete rep.replacedEvents;
        }
        if (Array.isArray(rep.newEvents)) {
          for (const e of rep.newEvents) {
            if (e && typeof e === "object") {
              sanitizeEventSource(e as Record<string, unknown>);
            }
          }
        }
      }
    }
  } else if (diff.replacedEvents == null) {
    diff.replacedEvents = [];
  }
}

function sanitizeCharacter(c: Record<string, unknown>): void {
  // 必填字段补默认值（LLM 常忘）
  if (c.schema_version == null) c.schema_version = 3;
  if (c.name_en == null && typeof c.name_zh === "string") c.name_en = c.name_zh;
  if (c.era_layer == null) c.era_layer = 1;
  if (c.portrait == null) c.portrait = "";
  if (c.thumb == null) c.thumb = "";

  // 类型修正：era_layer 可能是字符串 "1"
  if (typeof c.era_layer === "string") {
    const n = Number(c.era_layer);
    c.era_layer = Number.isFinite(n) && n >= 0 && n <= 5 ? Math.floor(n) : 1;
  }

  // aliases 可能是字符串而非数组
  if (typeof c.aliases === "string") {
    c.aliases = c.aliases ? [c.aliases] : [];
  }

  // 数组字段 null -> []
  const arrFields = ["aliases", "events", "quotes", "weapons", "skills", "domains", "mounts"];
  for (const f of arrFields) {
    if (c[f] == null) c[f] = [];
  }
  if (Array.isArray(c.events)) {
    for (const e of c.events) {
      if (e && typeof e === "object") {
        sanitizeEventSource(e as Record<string, unknown>);
      }
    }
  }
}

/**
 * 检查 Character 是否有不可补的必填字段（id, name_zh, category）
 * 这些字段缺了无法补，应过滤掉整个 node
 */
function hasRequiredCharacterFields(c: Record<string, unknown>): boolean {
  if (typeof c.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(c.id)) return false;
  if (typeof c.name_zh !== "string" || c.name_zh === "") return false;
  if (typeof c.category !== "string" || !/^[a-z][a-z0-9_]*$/.test(c.category)) return false;
  return true;
}

function sanitizeEventSource(e: Record<string, unknown>): void {
  // source 可能是字符串而非对象（LLM 偶尔输出 source: "《水浒传》"）
  if (typeof e.source === "string") {
    const work = e.source.trim();
    e.source = work ? { work, locus: null, translator: null } : null;
  }

  const source = e.source;
  if (source && typeof source === "object") {
    const s = source as Record<string, unknown>;
    // work = null/空 -> 整个 source = null
    if (s.work == null || s.work === "") {
      e.source = null;
    }
  }

  // canon 字段：LLM 偶尔误填叙事标签「原典」/「推演」/「杜撰」
  // 合法值只有 "romance" / "history" / "both" / null / undefined
  const canon = e.canon;
  if (canon != null) {
    const valid = canon === "romance" || canon === "history" || canon === "both";
    if (!valid) {
      e.canon = null;
    }
  }
}

function parseNarrativeBlock(block: string, raw: string): NarrativeSegment[] {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const segments: NarrativeSegment[] = [];

  for (const line of lines) {
    // 匹配叙事来源标签开头
    const match = line.match(/^【(原典|假设|推演|杜撰)】(.*)$/);
    if (!match) {
      // 跳过非标签行（LLM 偶尔多空行或解释）
      continue;
    }
    const label = match[1] as NarrativeLabel;
    const text = match[2].trim();
    if (!text) continue;
    segments.push({
      text,
      label,
      citation: null,
      characterIds: [],
    });
  }

  if (segments.length === 0) {
    throw new LLMParseError("NARRATIVE 块没有解析到任何带标签的段", raw);
  }
  return segments;
}

function parseChoicesBlock(block: string, raw: string): string[] {
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
  const choices: string[] = [];
  for (const line of lines) {
    // 去 "1. " / "1) " / "- " 前缀
    const cleaned = line.replace(/^[\d]+[.)]\s*|^[-*]\s*/, "").trim();
    if (cleaned) choices.push(cleaned);
  }
  if (choices.length === 0) {
    throw new LLMParseError("CHOICES 块没有解析到选项", raw);
  }
  return choices;
}

/**
 * 启发式解析：LLM 没严格按格式输出时的兜底
 * - 找第一个 ```json ... ``` 或 { ... } 作为 diff
 * - 找所有 【...】 开头的行作为 narrative
 * - 找所有 "数字. " 开头的行作为 choices
 */
function parseLenient(text: string): ParsedLLMOutput {
  // diff: 优先 ```json```，否则第一个 {...}
  let diffRaw: string | null = null;
  const jsonFence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonFence) {
    diffRaw = jsonFence[1];
  } else {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      diffRaw = text.slice(first, last + 1);
    }
  }
  if (!diffRaw) {
    throw new LLMParseError("无法定位 DIFF 块（无 === 分隔符，也无 JSON 围栏）", text);
  }

  const diff = parseDiffBlock(diffRaw, text);

  // narrative: 所有 【...】 行
  const narrative: NarrativeSegment[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^【(原典|假设|推演|杜撰)】(.*)$/);
    if (m) {
      const t = m[2].trim();
      if (t) {
        narrative.push({
          text: t,
          label: m[1] as NarrativeLabel,
          citation: null,
          characterIds: [],
        });
      }
    }
  }
  if (narrative.length === 0) {
    throw new LLMParseError("无法解析叙事（无 【原典/假设/推演/杜撰】 标签行）", text);
  }

  // choices: 末尾的 "数字. " 行
  const choices: string[] = [];
  const choicePattern = /^\s*\d+[.)]\s+(.+)$/;
  const lines = text.split("\n");
  // 从后往前找连续的 choice 行
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(choicePattern);
    if (m) {
      choices.unshift(m[1].trim());
    } else if (choices.length > 0) {
      // 已经开始收集 choices，遇到非 choice 行就停
      break;
    }
  }
  if (choices.length === 0) {
    throw new LLMParseError("无法解析选项（无 数字. 开头行）", text);
  }

  return { diff, narrative, choices };
}
