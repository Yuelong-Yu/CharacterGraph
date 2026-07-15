import { CharacterEvent, type Citation, type Dataset } from "@/schemas/character";

export interface UserEventEntry {
  id: string;
  event: CharacterEvent;
}

export type UserEventsByCharacter = Record<string, UserEventEntry[]>;

export function adaptationWork(work: string): string {
  const unwrapped = work.trim().replace(/^《|》$/g, "").replace(/-改编$/, "");
  return `${unwrapped}-改编`;
}

export function buildUserEventCitation(
  dataset: Dataset,
  characterId: string,
): Citation | null {
  const character = dataset.characters.find((item) => item.id === characterId);
  const characterWork = character?.events.find((event) => event.source?.work)?.source?.work;
  const fallbackWork = dataset.characters
    .flatMap((item) => item.events)
    .find((event) => event.source?.work)?.source?.work;
  const work = characterWork ?? fallbackWork;
  if (!work) return null;
  return {
    work: adaptationWork(work),
    locus: null,
    translator: null,
  };
}

export function mergeUserEvents(
  dataset: Dataset,
  userEvents: UserEventsByCharacter,
): Dataset {
  if (Object.keys(userEvents).length === 0) return dataset;
  return {
    ...dataset,
    characters: dataset.characters.map((character) => {
      const entries = userEvents[character.id];
      if (!entries?.length) return character;
      return {
        ...character,
        events: [...character.events, ...entries.map((entry) => entry.event)],
      };
    }),
  };
}

export function parseStoredUserEvents(value: unknown): UserEventsByCharacter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: UserEventsByCharacter = {};

  for (const [characterId, rawEntries] of Object.entries(value)) {
    if (!Array.isArray(rawEntries)) continue;
    const entries: UserEventEntry[] = [];
    for (const rawEntry of rawEntries) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const id = "id" in rawEntry ? rawEntry.id : null;
      const event = "event" in rawEntry ? CharacterEvent.safeParse(rawEntry.event) : null;
      if (typeof id !== "string" || !id || !event?.success) continue;
      if (!event.data.title.trim() || !event.data.desc.trim()) continue;
      entries.push({ id, event: event.data });
    }
    if (entries.length > 0) result[characterId] = entries;
  }

  return result;
}
