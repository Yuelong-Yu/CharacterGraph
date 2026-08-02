import { EventSourceParserStream } from "eventsource-parser/stream";
import type {
  GenerateUserCharacterInput,
  UserCharacterGenerationResult,
} from "@/schemas/userCharacter";
import type { Dataset } from "@/schemas/character";
import { withBasePath } from "@/lib/basePath";
import { AiQuotaRequestError } from "@/lib/aiQuotaError";

export interface UserCharacterGenerationProgress {
  stage: "targets" | "profile" | "relationships" | "reconnecting";
  completed: number;
  total: number;
}

class UserCharacterGenerationStreamError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "UserCharacterGenerationStreamError";
  }
}

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof UserCharacterGenerationStreamError) {
    return error.code === "LLM_ERROR" && /network|connection|timeout|temporar/i.test(error.message);
  }
  if (!(error instanceof Error)) return false;
  return /network error|fetch failed|HTTP 5\d\d|stream ended without a result|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|UND_ERR_|HTTP2_PROTOCOL_ERROR/i.test(error.message);
}

export async function streamUserCharacterGeneration(
  input: GenerateUserCharacterInput,
  handlers: {
    onProgress: (progress: UserCharacterGenerationProgress) => void;
    onDone: (result: UserCharacterGenerationResult & { sourceWork: string }) => void;
    onError: (error: { code: string; message: string }) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(withBasePath("/api/user-characters/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      if (!response.body) throw new Error("Response has no body");

      const events = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream());
      const reader = events.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.data) continue;
          const data = JSON.parse(value.data) as unknown;
          if (value.event === "progress") {
            handlers.onProgress(data as UserCharacterGenerationProgress);
          } else if (value.event === "done") {
            handlers.onDone(data as UserCharacterGenerationResult & { sourceWork: string });
            return;
          } else if (value.event === "error") {
            const failure = data as { code?: unknown; message?: unknown };
            throw new UserCharacterGenerationStreamError(
              typeof failure.code === "string" ? failure.code : "LLM_ERROR",
              typeof failure.message === "string" ? failure.message : "人物生成失败，请重试",
            );
          }
        }
      } finally {
        reader.releaseLock();
      }
      throw new Error("生成连接在返回结果前结束");
    } catch (error) {
      if (!signal?.aborted && attempt < 2 && isRetryableTransportError(error)) {
        handlers.onProgress({ stage: "reconnecting", completed: 0, total: 1 });
        continue;
      }
      if (error instanceof UserCharacterGenerationStreamError) {
        handlers.onError({ code: error.code, message: error.message });
        return;
      }
      throw error;
    }
  }
}

export interface UserCharacterHistoryImpact {
  count: number;
  turnIds: string[];
}

export async function fetchUserCharacterHistoryImpact(
  branchId: string,
  characterId: string,
): Promise<UserCharacterHistoryImpact> {
  const params = new URLSearchParams({ branchId, characterId });
  const response = await fetch(withBasePath(`/api/user-characters/history?${params}`));
  if (!response.ok) throw new Error(`读取受影响推演失败：HTTP ${response.status}`);
  return response.json() as Promise<UserCharacterHistoryImpact>;
}

async function postHistoryAction(body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(withBasePath("/api/user-characters/history"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (typeof data.code === "string") {
      throw new AiQuotaRequestError(
        typeof data.error === "string" ? data.error : `更新推演历史失败：HTTP ${response.status}`,
        data.code,
        response.status,
      );
    }
    throw new Error(typeof data.error === "string" ? data.error : `更新推演历史失败：HTTP ${response.status}`);
  }
  return data;
}

export async function regenerateUserCharacterHistory(input: {
  projectSlug: string;
  branchId: string;
  characterId: string;
  datasetOverlay: Pick<Dataset, "characters" | "relations">;
}): Promise<void> {
  await postHistoryAction({ action: "regenerate", ...input });
}

export async function deleteUserCharacterHistory(input: {
  projectSlug: string;
  branchId: string;
  characterId: string;
}): Promise<string[]> {
  const data = await postHistoryAction({ action: "delete", ...input });
  return Array.isArray(data.turnIds) ? data.turnIds.filter((id): id is string => typeof id === "string") : [];
}

export async function restoreUserCharacterHistory(input: {
  projectSlug: string;
  branchId: string;
  characterId: string;
  turnIds: string[];
}): Promise<void> {
  await postHistoryAction({ action: "restore", ...input });
}
