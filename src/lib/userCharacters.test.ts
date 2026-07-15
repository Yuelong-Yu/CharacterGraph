import { describe, expect, it } from "vitest";
import type { Dataset } from "@/schemas/character";
import {
  createUserCharacterId,
  defaultRelationshipCount,
  mergeUserCharacters,
  relationAdaptationsForCharacter,
  type UserCharacterRecord,
} from "@/lib/userCharacters";

const dataset: Dataset = {
  schema_version: 3,
  characters: [
    {
      schema_version: 3,
      id: "lin_chong",
      name_zh: "林冲",
      name_en: "Lin Chong",
      aliases: [],
      epithet: "豹子头",
      category: "hero",
      era_layer: 2,
      bio: "八十万禁军教头。",
      events: [],
      quotes: [],
      weapons: ["丈八蛇矛"],
      skills: [],
      domains: [],
      mounts: [],
      portrait: "/lin.webp",
      thumb: "/lin-thumb.webp",
    },
  ],
  artifacts: [],
  relations: [],
};

const record: UserCharacterRecord = {
  id: "shen_yan",
  projectSlug: "shuihu",
  scopeId: "base",
  background: "一名行脚书生误入梁山。",
  revision: 1,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
  character: {
    schema_version: 3,
    id: "shen_yan",
    name_zh: "沈砚",
    name_en: "Shen Yan",
    aliases: [],
    epithet: "行脚书生",
    category: "hero",
    era_layer: 2,
    bio: "误入梁山的行脚书生。",
    events: [{
      title: "夜入梁山",
      desc: "沈砚夜入梁山。",
      source: { work: "水浒传-改编", locus: "第一回" },
    }],
    quotes: [],
    weapons: [],
    skills: ["谋略"],
    domains: [],
    mounts: [],
    portrait: "",
    thumb: "",
  },
  relations: [{
    schema_version: 3,
    id: "user:shen_yan:lin_chong",
    source: "shen_yan",
    target: "lin_chong",
    primary_type: "ally",
    composite_types: [],
    events: [{
      title: "雪夜相救",
      desc: "林冲在雪夜救下沈砚。",
      source: { work: "水浒传-改编", locus: "第一回" },
      era_order: 2,
    }],
  }],
};

describe("user character graph overlay", () => {
  it("uses three as the default but keeps the full existing population as the maximum", () => {
    expect(defaultRelationshipCount(150)).toEqual({ defaultValue: 3, min: 1, max: 150 });
    expect(defaultRelationshipCount(2)).toEqual({ defaultValue: 2, min: 1, max: 2 });
    expect(defaultRelationshipCount(0)).toEqual({ defaultValue: 0, min: 0, max: 0 });
  });

  it("creates a pinyin id and adds a suffix when the id already exists", () => {
    expect(createUserCharacterId("沈砚", new Set(["lin_chong"]))).toBe("shen_yan");
    expect(createUserCharacterId("沈砚", new Set(["shen_yan"]))).toBe("shen_yan_2");
  });

  it("merges a scoped record without mutating the canonical dataset", () => {
    const merged = mergeUserCharacters(dataset, [record]);

    expect(merged.characters.map((character) => character.id)).toEqual(["lin_chong", "shen_yan"]);
    expect(merged.relations.map((relation) => relation.id)).toEqual(["user:shen_yan:lin_chong"]);
    expect(dataset.characters).toHaveLength(1);
    expect(dataset.relations).toHaveLength(0);
  });

  it("shows relation adaptations in both participants without changing canonical events", () => {
    const adaptations = relationAdaptationsForCharacter([record], "lin_chong");

    expect(adaptations).toEqual([{
      recordId: "shen_yan",
      relationId: "user:shen_yan:lin_chong",
      otherCharacterId: "shen_yan",
      event: record.relations[0].events[0],
    }]);
    expect(dataset.characters[0].events).toEqual([]);
  });
});
