/**
 * 浏览器端 SSE 客户端：POST /api/whatif 并解析流式响应。
 * 服务端重试时会发送 reset，调用方必须清空已累积的草稿文本。
 *
 * 浏览器原生 EventSource 只支持 GET，所以用 fetch + ReadableStream + eventsource-parser。
 */

import { EventSourceParserStream } from "eventsource-parser/stream";
import type {
  CreateWhatIfSessionInput,
  GraphDiff,
  NarrativeSegment,
  ValidationResult,
} from "@/schemas/whatif";

export interface WhatIfStreamHandlers {
  onDelta: (text: string) => void;
  onReset: () => void;
  onDone: (data: {
    turnId: string;
    sessionId: string;
    branchId: string;
    diff: GraphDiff;
    narrative: NarrativeSegment[];
    choices: string[];
    validation: ValidationResult[];
  }) => void;
  onError: (error: { code: string; message: string; raw?: string }) => void;
}

/**
 * 发起 WhatIf 流式请求。
 *
 * 用 AbortController 外部中断：传 signal 即可。
 */
export async function streamWhatIf(
  input: CreateWhatIfSessionInput,
  handlers: WhatIfStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch("/api/whatif", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  if (!resp.body) {
    throw new Error("Response has no body");
  }

  // eventsource-parser v3 提供 Web Stream 友好的 parser
  const eventStream = resp.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  const reader = eventStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.data) continue;

      let data: unknown;
      try {
        data = JSON.parse(value.data);
      } catch {
        continue;
      }

      if (value.event === "delta") {
        const d = data as { text?: string };
        if (typeof d.text === "string") handlers.onDelta(d.text);
      } else if (value.event === "reset") {
        handlers.onReset();
      } else if (value.event === "done") {
        handlers.onDone(data as Parameters<typeof handlers.onDone>[0]);
      } else if (value.event === "error") {
        handlers.onError(data as Parameters<typeof handlers.onError>[0]);
      }
    }
  } catch (e) {
    // AbortError 是正常中断，不报错
    if (e instanceof Error && e.name === "AbortError") return;
    throw e;
  } finally {
    reader.releaseLock();
  }
}

/** 续写 turn 的 done 事件 payload（多了 order 字段） */
export interface ContinueTurnDoneData {
  turnId: string;
  sessionId: string;
  branchId: string;
  order: number;
  diff: GraphDiff;
  narrative: NarrativeSegment[];
  choices: string[];
  validation: ValidationResult[];
}

export interface ContinueTurnHandlers {
  onDelta: (text: string) => void;
  onReset: () => void;
  onDone: (data: ContinueTurnDoneData) => void;
  onError: (error: { code: string; message: string; raw?: string }) => void;
}

/**
 * 发起续写 turn 流式请求。
 */
export async function streamContinueTurn(
  sessionId: string,
  userInput: string,
  handlers: ContinueTurnHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(`/api/whatif/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userInput }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  if (!resp.body) {
    throw new Error("Response has no body");
  }

  const eventStream = resp.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  const reader = eventStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.data) continue;

      let data: unknown;
      try {
        data = JSON.parse(value.data);
      } catch {
        continue;
      }

      if (value.event === "delta") {
        const d = data as { text?: string };
        if (typeof d.text === "string") handlers.onDelta(d.text);
      } else if (value.event === "reset") {
        handlers.onReset();
      } else if (value.event === "done") {
        handlers.onDone(data as ContinueTurnDoneData);
      } else if (value.event === "error") {
        handlers.onError(data as Parameters<typeof handlers.onError>[0]);
      }
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    throw e;
  } finally {
    reader.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// Session / Branch 管理
// ─────────────────────────────────────────────────────────────

import type { WhatIfSessionDetail, WhatIfSessionSummary } from "@/schemas/whatif";

/** 拉取完整 session（含所有 branches + turns） */
export async function fetchSession(sessionId: string): Promise<WhatIfSessionDetail> {
  const resp = await fetch(`/api/whatif/${sessionId}`);
  if (!resp.ok) {
    throw new Error(`fetchSession HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.session as WhatIfSessionDetail;
}

/** 列出项目的所有 session 摘要 */
export async function listSessions(projectSlug: string): Promise<WhatIfSessionSummary[]> {
  const resp = await fetch(`/api/whatif?projectSlug=${encodeURIComponent(projectSlug)}`);
  if (!resp.ok) {
    throw new Error(`listSessions HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.sessions as WhatIfSessionSummary[];
}

/** 从某 turn fork 新分支，返回新 branch id */
export async function forkBranch(
  sessionId: string,
  parentTurnId: string,
  title?: string,
): Promise<string> {
  const resp = await fetch(`/api/whatif/${sessionId}/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentTurnId, title }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`forkBranch HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.branch.id as string;
}

/** 切换 active branch，返回更新后的完整 session */
export async function switchBranch(
  sessionId: string,
  branchId: string,
): Promise<WhatIfSessionDetail> {
  const resp = await fetch(
    `/api/whatif/${sessionId}/branches/${branchId}`,
    { method: "PATCH" },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`switchBranch HTTP ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data.session as WhatIfSessionDetail;
}
