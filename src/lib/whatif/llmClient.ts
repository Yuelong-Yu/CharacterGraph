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
  type ParsedLLMOutput,
} from "@/lib/whatif/promptBuilder";

const apiKey = process.env.CODING_API_KEY;
const baseURL = process.env.CODING_BASE_URL || "https://ark.cn-beijing.volces.com/api/coding";
const model = process.env.CODING_MODEL || "deepseek-v4-flash";

let client: Anthropic | null = null;

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
  system: string,
  user: string,
  maxTokens: number,
  onDelta: (delta: string) => void,
  onRetry?: () => void,
): Promise<void> {
  const TIMEOUT_MS = 120_000;
  const MAX_ATTEMPTS = 2;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const c = getClient();
      let receivedText = false;
      const stream = await c.messages.create(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: user }],
          stream: true,
        },
        { signal: controller.signal },
      );

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          if (event.delta.text.length > 0) receivedText = true;
          onDelta(event.delta.text);
        }
      }
      if (!receivedText) {
        const emptyError = new Error("LLM 返回了空响应");
        emptyError.name = "EmptyLLMResponseError";
        throw emptyError;
      }
      clearTimeout(timer);
      return; // 成功，直接返回
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      // AbortError = 超时；网络错误也重试
      const isRetryable =
        e instanceof Error &&
        (e.name === "AbortError" ||
          e.name === "EmptyLLMResponseError" ||
          e.message.includes("ECONNRESET") ||
          e.message.includes("ETIMEDOUT") ||
          e.message.includes("fetch failed"));
      if (!isRetryable || attempt === MAX_ATTEMPTS) {
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
  system: string,
  user: string,
  maxTokens: number,
  onDelta: (delta: string) => void,
  onReset: () => void,
): Promise<ParsedLLMOutput> {
  const MAX_PARSE_ATTEMPTS = 2;
  let lastParseError: LLMParseError | null = null;

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    let fullText = "";
    const attemptUser = attempt === 1
      ? user
      : `${user}\n\n上一次响应格式无效。请严格输出且只输出要求的三个区块，DIFF 必须是合法 JSON。`;

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
    );

    try {
      return parseLLMOutput(fullText);
    } catch (error) {
      if (!(error instanceof LLMParseError)) throw error;
      lastParseError = error;
      if (attempt === MAX_PARSE_ATTEMPTS) throw error;
      onReset();
    }
  }

  throw lastParseError ?? new Error("LLM 输出解析失败");
}
