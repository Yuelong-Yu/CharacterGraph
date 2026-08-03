import { describe, expect, it } from "vitest";
import type { Character } from "@/schemas/character";
import { entityMatchesSearch } from "@/lib/searchMatch";

const character: Character = {
  schema_version: 3,
  id: "sun_wukong",
  name_zh: "孙悟空",
  name_en: "Sun Wukong",
  aliases: ["齐天大圣"],
  epithet: "斗战胜佛",
  category: "monster",
  era_layer: 0,
  bio: "花果山的美猴王",
  events: [],
  quotes: [],
  weapons: [],
  skills: [],
  domains: [],
  mounts: [],
  portrait: "",
  thumb: "",
};

describe("entityMatchesSearch", () => {
  it("matches Chinese names, English names, aliases, and pinyin", () => {
    expect(entityMatchesSearch(character, "悟空")).toBe(true);
    expect(entityMatchesSearch(character, "wukong")).toBe(true);
    expect(entityMatchesSearch(character, "大圣")).toBe(true);
    expect(entityMatchesSearch(character, "qtds")).toBe(true);
  });

  it("keeps the graph search's fuzzy substring semantics", () => {
    expect(entityMatchesSearch(character, "花果")).toBe(true);
    expect(entityMatchesSearch(character, "哪吒")).toBe(false);
  });
});
