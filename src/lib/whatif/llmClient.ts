/**
 * LLM 客户端：调火山方舟兼容 Anthropic Messages API 的 deepseek-v4-flash
 *
 * 与 scripts/data/llm_client.py 协议一致：
 *   - baseURL = CODING_BASE_URL (默认 https://ark.cn-beijing.volces.com/api/coding)
 *   - model = CODING_MODEL (默认 deepseek-v4-flash)
 *   - apiKey = CODING_API_KEY
 *
 * callLLMStream 负责底层流式调用，generateParsedWhatIf 在其上完成格式解析重试。
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  LLMParseError,
  parseLLMOutput,
  tryRecoverMissingDiffOutput,
  WHAT_IF_OUTPUT_JSON_SCHEMA,
  type CacheableSystemPrompt,
  type ParsedLLMOutput,
} from "@/lib/whatif/promptBuilder";

const apiKey = process.env.CODING_API_KEY;
const baseURL = process.env.CODING_BASE_URL || "https://ark.cn-beijing.volces.com/api/coding";
const model = process.env.CODING_MODEL || "deepseek-v4-flash";

/** 推演的单次上游调用输出上限，给模型思考与结构化 JSON 留出余量。 */
export const WHAT_IF_MAX_TOKENS = 20_000;

const REFUSAL_PATTERNS = [
  /无法给到相关内容/,
  /无法识别/,
  /(?:抱歉|对不起)[\s\S]{0,30}(?:无法|不能)[\s\S]{0,30}(?:提供|生成|回答|协助|处理)/,
  /我(?:无法|不能)[\s\S]{0,30}(?:提供|生成|回答|协助|处理)/,
];

export class LLMRefusalError extends Error {
  constructor(readonly raw: string) {
    super("模型拒绝了本次文学推演内容。已自动改用非血腥、非操作性的表述重试，但仍未获得有效响应");
    this.name = "LLMRefusalError";
  }
}

function isLLMRefusal(text: string): boolean {
  const compact = text.trim();
  return compact.length <= 300 && REFUSAL_PATTERNS.some((pattern) => pattern.test(compact));
}

function parseFailureReason(error: LLMParseError): string {
  if (error.message.includes('"diff":["Required"]')) return "missing_diff";
  if (error.message.includes("不是合法 JSON")) return "invalid_json";
  if (error.message.includes("必须是 JSON 对象")) return "non_object_json";
  return "schema_validation";
}

function buildRefusalRecoveryPrompt(user: string): string {
  const softened = user
    .replaceAll("夺权", "争取梁山内部主导权")
    .replaceAll("刺杀", "袭击")
    .replaceAll("杀手", "追兵")
    .replaceAll("杀死", "击败")
    .replaceAll("杀出重围", "脱离困境")
    .replaceAll("项上人头", "性命")
    .replaceAll("咽喉", "要害");

  return `${softened}

这是虚构文学作品的人物关系图谱推演。请用概括、非血腥、非操作性的方式表现冲突，保留人物关系与故事因果，不展开伤害细节。严格输出且只输出一个 JSON 根对象，必须包含 diff、narrative、choices 三个字段；即使没有图谱变化，diff 也必须包含六个空数组。`;
}

function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // The SDK wraps failures before a stream starts in APIConnectionError. A stream
  // can also fail mid-response with the underlying fetch error, whose message is
  // commonly just "network error" in production.
  if (
    (typeof Anthropic.APIConnectionError === "function" &&
      error instanceof Anthropic.APIConnectionError)
  ) {
    return true;
  }

  return error.name === "AbortError" ||
    /(?:network|connection) error|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|UND_ERR_/i.test(error.message);
}

let client: Anthropic | null = null;

export interface ProviderTimingEvent {
  stage: "request-ready" | "first-text" | "attempt-complete" | "usage";
  attempt: number;
  elapsedMs: number;
  inputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  outputTokens?: number;
}

export type SystemPrompt = string | CacheableSystemPrompt;

/**
 * 在不可变原典子图之后建立缓存断点。后续的分支状态和人物索引虽然每轮仍会
 * 完整提交，但不会改变此前的 token 前缀，因此同一人物的续写可命中 KV Cache。
 */
function toProviderSystem(system: SystemPrompt) {
  if (typeof system === "string") return system;

  return [
    {
      type: "text" as const,
      text: system.cacheable,
      cache_control: { type: "ephemeral" as const },
    },
    {
      type: "text" as const,
      text: system.dynamic,
    },
  ];
}

function usageFromProviderEvent(usage: {
  input_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  output_tokens: number | null;
}) {
  return {
    inputTokens: usage.input_tokens ?? undefined,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    outputTokens: usage.output_tokens ?? undefined,
  };
}

function getClient(): Anthropic {
  if (!apiKey) {
    throw new Error("CODING_API_KEY 未设置（检查仓库根 .env）");
  }
  if (!client) {
    client = new Anthropic({ apiKey, baseURL });
  }
  return client;
}

/**
 * 流式调 LLM，每个 text_delta 触发 onDelta 回调。
 * 完成后 resolve（不返回内容，调用方自行累积）。
 *
 * 内置 120s 超时（AbortController）+ 1 次自动重试（网络/超时/空响应）。
 */
export async function callLLMStream(
  system: SystemPrompt,
  user: string,
  maxTokens: number,
  onDelta: (delta: string) => void,
  onRetry?: () => void,
  options: {
    timeoutMs?: number;
    maxAttempts?: number;
    onProviderTiming?: (event: ProviderTimingEvent) => void;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxAttempts = options.maxAttempts ?? 2;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStartedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const c = getClient();
      let receivedText = false;
      let stopReason: string | null = null;
      let finalUsage: ReturnType<typeof usageFromProviderEvent> | undefined;
      const stream = await c.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: toProviderSystem(system),
          messages: [{ role: "user", content: user }],
          output_config: {
            format: {
              type: "json_schema",
              schema: WHAT_IF_OUTPUT_JSON_SCHEMA,
            },
          },
          stream: true,
        },
        { signal: controller.signal },
      );
      options.onProviderTiming?.({
        stage: "request-ready",
        attempt,
        elapsedMs: Math.round(performance.now() - attemptStartedAt),
      });

      for await (const event of stream) {
        if (event.type === "message_start") {
          finalUsage = usageFromProviderEvent(event.message.usage);
        }
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          if (event.delta.text.length > 0 && !receivedText) {
            options.onProviderTiming?.({
              stage: "first-text",
              attempt,
              elapsedMs: Math.round(performance.now() - attemptStartedAt),
            });
          }
          if (event.delta.text.length > 0) receivedText = true;
          onDelta(event.delta.text);
        }
        if (event.type === "message_delta") {
          stopReason = event.delta.stop_reason;
          // 方舟兼容流可能只在最后一个 message_delta 中返回缓存用量。
          finalUsage = usageFromProviderEvent(event.usage);
        }
      }
      if (finalUsage) {
        options.onProviderTiming?.({
          stage: "usage",
          attempt,
          elapsedMs: Math.round(performance.now() - attemptStartedAt),
          ...finalUsage,
        });
      }
      if (stopReason === "max_tokens") {
        const limitError = new Error(
          `LLM 输出 token 上限耗尽，响应可能只有思考过程或正文不完整（max_tokens=${maxTokens}）`,
        );
        limitError.name = "LLMOutputLimitError";
        throw limitError;
      }
      if (!receivedText) {
        const emptyError = new Error("LLM 返回了空响应");
        emptyError.name = "EmptyLLMResponseError";
        throw emptyError;
      }
      clearTimeout(timer);
      options.onProviderTiming?.({
        stage: "attempt-complete",
        attempt,
        elapsedMs: Math.round(performance.now() - attemptStartedAt),
      });
      return; // 成功，直接返回
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      options.onProviderTiming?.({
        stage: "attempt-complete",
        attempt,
        elapsedMs: Math.round(performance.now() - attemptStartedAt),
      });
      // AbortError = 超时；网络错误也重试
      const isRetryable =
        (e instanceof Error && e.name === "EmptyLLMResponseError") ||
        isRetryableTransportError(e);
      if (!isRetryable || attempt === maxAttempts) {
        throw e;
      }
      onRetry?.();
      // 重试前等 2 秒
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastError;
}

/**
 * 生成并解析一次 WhatIf 输出。完整响应格式无效时重新生成一次；每次重试前
 * 通过 onReset 通知 SSE 调用方丢弃已展示的失败草稿。
 */
export async function generateParsedWhatIf(
  system: SystemPrompt,
  user: string,
  maxTokens: number,
  onDelta: (delta: string) => void,
  onReset: () => void,
  options: { onProviderTiming?: (event: ProviderTimingEvent) => void } = {},
): Promise<ParsedLLMOutput> {
  const MAX_PARSE_ATTEMPTS = 2;
  let lastParseError: LLMParseError | null = null;

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    let fullText = "";
    const attemptUser = attempt === 1
      ? user
      : lastParseError && isLLMRefusal(lastParseError.raw)
        ? buildRefusalRecoveryPrompt(user)
        : `${user}\n\n上一次响应不符合 JSON Schema。请严格输出且只输出一个 JSON 根对象，必须同时包含 diff、narrative、choices 三个字段。即使本轮没有图谱变化，diff 也必须包含 removedNodes、addedNodes、removedEdges、addedEdges、modifiedEvents、replacedEvents 六个数组字段。`;

    await callLLMStream(
      system,
      attemptUser,
      maxTokens,
      (delta) => {
        fullText += delta;
        onDelta(delta);
      },
      () => {
        fullText = "";
        onReset();
      },
      { onProviderTiming: options.onProviderTiming },
    );

    try {
      return parseLLMOutput(fullText);
    } catch (error) {
      if (!(error instanceof LLMParseError)) throw error;
      const recovered = tryRecoverMissingDiffOutput(fullText);
      if (recovered) {
        console.warn("[whatif-output-repair]", JSON.stringify({ repair: "missing_diff_defaulted", attempt }));
        return recovered;
      }
      lastParseError = error;
      console.warn("[whatif-output-retry]", JSON.stringify({
        reason: parseFailureReason(error),
        attempt,
      }));
      if (attempt === MAX_PARSE_ATTEMPTS) {
        if (isLLMRefusal(error.raw)) throw new LLMRefusalError(error.raw);
        throw error;
      }
      onReset();
    }
  }

  throw lastParseError ?? new Error("LLM 输出解析失败");
}
