import { describe, expect, it } from "vitest";
import type { Character, Dataset } from "@/schemas/character";
import {
  buildUserEventCitation,
  mergeUserEvents,
  parseStoredUserEvents,
  type UserEventsByCharacter,
} from "@/lib/userEvents";

function makeCharacter(id: string, work = "《水浒传》"): Character {
  return {
    schema_version: 3,
    id,
    name_zh: id,
    name_en: id,
    aliases: [],
    epithet: null,
    category: "hero",
    era_layer: 1,
    bio: null,
    events: [{
      title: "原典事件",
      desc: "原典描述",
      source: { work, locus: "第一回", translator: null },
    }],
    quotes: [],
    weapons: [],
    skills: [],
    domains: [],
    mounts: [],
    portrait: "",
    thumb: "",
  };
}

const base: Dataset = {
  schema_version: 3,
  characters: [makeCharacter("lin_chong")],
  artifacts: [],
  relations: [],
};

describe("userEvents", () => {
  it("marks a user-created event as an adaptation of the corresponding work", () => {
    expect(buildUserEventCitation(base, "lin_chong")).toEqual({
      work: "水浒传-改编",
      locus: null,
      translator: null,
    });
  });

  it("merges stored events without mutating the canonical dataset", () => {
    const stored: UserEventsByCharacter = {
      lin_chong: [{
        id: "user-event-1",
        event: {
          title: "自创事件",
          desc: "自创描述",
          source: { work: "水浒传-改编", locus: null, translator: null },
        },
      }],
    };

    const result = mergeUserEvents(base, stored);

    expect(base.characters[0].events).toHaveLength(1);
    expect(result.characters[0].events.map((event) => event.title)).toEqual([
      "原典事件",
      "自创事件",
    ]);
  });

  it("drops malformed local-storage entries", () => {
    expect(parseStoredUserEvents({
      lin_chong: [
        {
          id: "valid",
          event: { title: "有效", desc: "描述", source: null },
        },
        {
          id: "invalid",
          event: { title: "", desc: 42 },
        },
      ],
      invalid_character: "not-an-array",
    })).toEqual({
      lin_chong: [{
        id: "valid",
        event: { title: "有效", desc: "描述", source: null },
      }],
    });
  });
});
