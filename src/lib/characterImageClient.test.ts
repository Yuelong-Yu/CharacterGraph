import { afterEach, describe, expect, it, vi } from "vitest";
import type { Character } from "@/schemas/character";
import { generateCharacterImage } from "@/lib/characterImageClient";

const character: Character = {
  schema_version: 3,
  id: "test_character",
  name_zh: "测试人物",
  name_en: "Test Character",
  aliases: [],
  epithet: null,
  category: "hero",
  era_layer: 0,
  bio: null,
  events: [],
  quotes: [],
  weapons: [],
  skills: [],
  domains: [],
  mounts: [],
  portrait: "",
  thumb: "",
};

afterEach(() => vi.unstubAllGlobals());

describe("generateCharacterImage", () => {
  it("retries a transient 524 response and returns the recovered image asset", async () => {
    const asset = {
      portrait: "/portrait.webp",
      thumb: "/thumb.webp",
      ownerBranchId: "branch-1",
      version: "1",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 524 }))
      .mockResolvedValueOnce(Response.json({ asset }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateCharacterImage({
      projectSlug: "greek",
      branchId: "branch-1",
      character,
      regenerate: false,
    })).resolves.toEqual(asset);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not automatically retry a regeneration, which could duplicate a paid request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 524 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateCharacterImage({
      projectSlug: "greek",
      branchId: "branch-1",
      character: { ...character, portrait: "/existing.webp" },
      regenerate: true,
    })).rejects.toThrow("HTTP 524");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
