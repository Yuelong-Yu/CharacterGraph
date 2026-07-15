import { describe, expect, it } from "vitest";
import {
  branchDirectoryKey,
  characterImageFingerprint,
  fallbackCharacterImagePrompt,
} from "@/lib/server/branchImageAssets";
import type { Character } from "@/schemas/character";

const character: Character = {
  schema_version: 3,
  id: "wang_pangpang",
  name_zh: "王胖胖",
  name_en: "Wang Pangpang",
  aliases: [],
  epithet: "胖胖",
  category: "hero",
  era_layer: 1,
  bio: "误入梁山的异乡人。",
  events: [{ title: "初遇宋江", desc: "在梁山附近遇见宋江。", source: null }],
  quotes: [],
  weapons: ["多功能工具"],
  skills: ["数据分析"],
  domains: [],
  mounts: [],
  portrait: "",
  thumb: "",
};

describe("branch image assets", () => {
  it("turns an arbitrary stable branch id into a traversal-safe directory key", () => {
    const key = branchDirectoryKey("user-branch:../../A B");
    expect(key).toMatch(/^[a-z0-9_-]+-[a-f0-9]{12}$/);
    expect(key).not.toContain("..");
    expect(branchDirectoryKey("user-branch:../../A B")).toBe(key);
    expect(branchDirectoryKey("user-branch:../../A C")).not.toBe(key);
  });

  it("fingerprints visual facts but ignores existing image URLs", () => {
    const first = characterImageFingerprint(character, "来自现代");
    const withImages = characterImageFingerprint({
      ...character,
      portrait: "/portrait.webp",
      thumb: "/thumb.webp",
    }, "来自现代");
    expect(withImages).toBe(first);
    expect(characterImageFingerprint({ ...character, bio: "不同经历" }, "来自现代")).not.toBe(first);
  });

  it("builds a deterministic prompt when the text LLM is unavailable", () => {
    const prompt = fallbackCharacterImagePrompt(character, "来自现代");
    expect(prompt).toContain("王胖胖");
    expect(prompt).toContain("多功能工具");
    expect(prompt).toContain("2:3竖向构图");
    expect(prompt).toContain("不添加文字");
  });
});
