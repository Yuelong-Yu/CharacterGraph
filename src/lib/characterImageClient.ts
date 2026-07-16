import type { Character } from "@/schemas/character";
import type { CharacterImageAsset } from "@/schemas/characterImage";
import { withBasePath } from "@/lib/basePath";

async function postCharacterImageRequest(body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(withBasePath("/api/character-images"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `图像服务请求失败：HTTP ${response.status}`);
  }
  return data;
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
  const data = await postCharacterImageRequest({ action: "generate", ...input });
  return data.asset as CharacterImageAsset;
}
