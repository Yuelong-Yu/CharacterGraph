import { pinyin } from "pinyin-pro";
import type {
  Character,
  Dataset,
  Relation,
  RelationEvent,
} from "@/schemas/character";

export const BASE_USER_CHARACTER_SCOPE = "base";

export interface UserCharacterRecord {
  id: string;
  projectSlug: string;
  scopeId: string;
  background: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  character: Character;
  relations: Relation[];
}

export interface RelationAdaptation {
  recordId: string;
  relationId: string;
  otherCharacterId: string;
  event: RelationEvent;
}

export function defaultRelationshipCount(existingCharacterCount: number): {
  defaultValue: number;
  min: number;
  max: number;
} {
  const count = Math.max(0, Math.floor(existingCharacterCount));
  if (count === 0) return { defaultValue: 0, min: 0, max: 0 };
  return { defaultValue: Math.min(3, count), min: 1, max: count };
}

function slugifyChineseName(name: string): string {
  const parts = pinyin(name.trim(), { toneType: "none", type: "array" })
    .map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
  const candidate = parts.join("_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return /^[a-z]/.test(candidate) ? candidate : `user_${candidate || "character"}`;
}

export function createUserCharacterId(name: string, existingIds: ReadonlySet<string>): string {
  const base = slugifyChineseName(name);
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function mergeUserCharacters(
  dataset: Dataset,
  records: readonly UserCharacterRecord[],
): Dataset {
  if (records.length === 0) return dataset;

  const characterById = new Map(dataset.characters.map((character) => [character.id, character]));
  const relationById = new Map(dataset.relations.map((relation) => [relation.id, relation]));

  for (const record of records) {
    characterById.set(record.character.id, record.character);
    for (const relation of record.relations) relationById.set(relation.id, relation);
  }

  return {
    ...dataset,
    characters: Array.from(characterById.values()),
    relations: Array.from(relationById.values()),
  };
}

export function relationAdaptationsForCharacter(
  records: readonly UserCharacterRecord[],
  characterId: string,
  existingEvents: readonly Character["events"][number][] = [],
): RelationAdaptation[] {
  const adaptations: RelationAdaptation[] = [];
  const seenEvents = new Set(existingEvents.map(eventIdentity));
  for (const record of records) {
    for (const relation of record.relations) {
      if (relation.source !== characterId && relation.target !== characterId) continue;
      const otherCharacterId = relation.source === characterId ? relation.target : relation.source;
      for (const event of relation.events) {
        const identity = eventIdentity(event);
        if (seenEvents.has(identity)) continue;
        seenEvents.add(identity);
        adaptations.push({
          recordId: record.id,
          relationId: relation.id,
          otherCharacterId,
          event,
        });
      }
    }
  }
  return adaptations.sort((left, right) => left.event.era_order - right.event.era_order);
}

function eventIdentity(event: Pick<Character["events"][number], "title" | "desc">): string {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  return `${normalize(event.title)}\u0000${normalize(event.desc)}`;
}

export function customDatasetOverlay(records: readonly UserCharacterRecord[]): Pick<Dataset, "characters" | "relations"> {
  return {
    characters: records.map((record) => record.character),
    relations: records.flatMap((record) => record.relations),
  };
}

export function mergeDatasetOverlay(
  dataset: Dataset,
  overlay: Pick<Dataset, "characters" | "relations"> | null | undefined,
): Dataset {
  if (!overlay || (overlay.characters.length === 0 && overlay.relations.length === 0)) return dataset;
  const characters = new Map(dataset.characters.map((character) => [character.id, character]));
  const relations = new Map(dataset.relations.map((relation) => [relation.id, relation]));
  for (const character of overlay.characters) characters.set(character.id, character);
  for (const relation of overlay.relations) relations.set(relation.id, relation);
  return {
    ...dataset,
    characters: Array.from(characters.values()),
    relations: Array.from(relations.values()),
  };
}
