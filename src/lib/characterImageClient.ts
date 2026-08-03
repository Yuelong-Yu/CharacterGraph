import type { Character } from "@/schemas/character";
import type { CharacterImageAsset } from "@/schemas/characterImage";
import { withBasePath } from "@/lib/basePath";

const TRANSIENT_GENERATION_STATUSES = new Set([502, 503, 504, 524]);
const RETRY_DELAY_MS = 500;

class CharacterImageRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "CharacterImageRequestError";
  }
}

async function postCharacterImageRequest(body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(withBasePath("/api/character-images"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new CharacterImageRequestError(
      response.status,
      typeof data.error === "string" ? data.error : `图像服务请求失败：HTTP ${response.status}`,
    );
  }
  return data;
}

function waitForRetry(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

export async function fetchCharacterImageAssets(input: {
  projectSlug: string;
  branchId: string;
  characterIds: string[];
}): Promise<Record<string, CharacterImageAsset | null>> {
  const data = await postCharacterImageRequest({ action: "status", ...input });
  return (data.assets ?? {}) as Record<string, CharacterImageAsset | null>;
}

export async function generateCharacterImage(input: {
  projectSlug: string;
  branchId: string;
  character: Character;
  background?: string;
  regenerate: boolean;
}): Promise<CharacterImageAsset> {
  try {
    const data = await postCharacterImageRequest({ action: "generate", ...input });
    return data.asset as CharacterImageAsset;
  } catch (error) {
    // 初次生成没有既有图像可被覆盖。仅对它自动重试一次，既修复网关短暂
    // 524，又避免“重新生成”在响应丢失时可能产生第二次付费请求。
    if (
      input.regenerate
      || !(error instanceof CharacterImageRequestError)
      || !TRANSIENT_GENERATION_STATUSES.has(error.status)
    ) {
      throw error;
    }
    await waitForRetry();
    const data = await postCharacterImageRequest({ action: "generate", ...input });
    return data.asset as CharacterImageAsset;
  }
}
