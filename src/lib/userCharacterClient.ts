import { EventSourceParserStream } from "eventsource-parser/stream";
import type {
  GenerateUserCharacterInput,
  UserCharacterGenerationResult,
} from "@/schemas/userCharacter";
import type { Dataset } from "@/schemas/character";
import { withBasePath } from "@/lib/basePath";

export interface UserCharacterGenerationProgress {
  stage: "targets" | "profile" | "relationships";
  completed: number;
  total: number;
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
      } else if (value.event === "error") {
        handlers.onError(data as { code: string; message: string });
      }
    }
  } finally {
    reader.releaseLock();
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
