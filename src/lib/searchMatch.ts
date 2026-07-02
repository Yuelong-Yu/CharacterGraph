import { pinyin } from "pinyin-pro";
import type { Artifact, Character } from "@/schemas/character";

export type SearchEntity = Character | Artifact;
export type SearchOrigin = "name" | "alias" | "epithet" | "fulltext";

const pinyinCache = new Map<string, { full: string; initials: string }>();

function normalizeLatin(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPinyinLikeQuery(q: string): boolean {
  return /[a-z]/i.test(q) && !/[\u3400-\u9fff]/.test(q);
}

function hasHan(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function getPinyinKey(text: string): { full: string; initials: string } {
  const hit = pinyinCache.get(text);
  if (hit) return hit;

  const syllables = pinyin(text, { toneType: "none", type: "array" })
    .map((part) => normalizeLatin(part))
    .filter(Boolean);
  const key = {
    full: syllables.join(""),
    initials: syllables.map((part) => part[0] ?? "").join(""),
  };
  pinyinCache.set(text, key);
  return key;
}

function textMatchesPinyin(text: string | null | undefined, normalizedQuery: string): boolean {
  if (!text || !normalizedQuery) return false;
  const { full, initials } = getPinyinKey(text);
  return full.includes(normalizedQuery) || initials.includes(normalizedQuery);
}

function anyTextMatchesPinyin(texts: Array<string | null | undefined>, normalizedQuery: string): boolean {
  return texts.some((text) => !!text && hasHan(text) && textMatchesPinyin(text, normalizedQuery));
}

function directTextMatch(text: string | null | undefined, q: string, qLower: string): boolean {
  if (!text) return false;
  return text.includes(q) || text.toLowerCase().includes(qLower);
}

function hasCharacterOnlyMatch(c: Character, q: string): boolean {
  return c.quotes.some((qu) => qu.text.includes(q)) || c.skills.some((s) => s.includes(q));
}

export function matchSearchEntity(entity: SearchEntity, rawQuery: string): { origin: SearchOrigin; snippet?: string } | null {
  const q = rawQuery.trim();
  if (!q) return null;
  const qLower = q.toLowerCase();
  const pinyinQuery = isPinyinLikeQuery(q) ? normalizeLatin(q) : null;

  if (
    directTextMatch(entity.name_zh, q, qLower) ||
    directTextMatch(entity.name_en, q, qLower) ||
    (pinyinQuery && textMatchesPinyin(entity.name_zh, pinyinQuery))
  ) {
    return { origin: "name" };
  }

  if (
    entity.aliases.some((alias) => directTextMatch(alias, q, qLower)) ||
    (pinyinQuery && anyTextMatchesPinyin(entity.aliases, pinyinQuery))
  ) {
    return { origin: "alias" };
  }

  if (
    directTextMatch(entity.epithet, q, qLower)
  ) {
    return { origin: "epithet" };
  }

  const inBio = entity.bio?.includes(q) ?? false;
  const inEvents = entity.events.some((event) => event.title.includes(q) || event.desc.includes(q));
  const inDomains = entity.domains.some((domain) => domain.includes(q));
  const inCharacterOnly = "quotes" in entity && hasCharacterOnlyMatch(entity, q);

  if (inBio || inEvents || inDomains || inCharacterOnly) {
    let snippet = "";
    const search = (text: string | null | undefined) => {
      if (!text) return false;
      const idx = text.indexOf(q);
      if (idx < 0) return false;
      snippet = "..." + text.slice(Math.max(0, idx - 20), idx + q.length + 30) + "...";
      return true;
    };
    if (!search(entity.bio)) {
      for (const event of entity.events) if (search(event.title + " " + event.desc)) break;
    }
    if (!snippet && "quotes" in entity) {
      for (const quote of entity.quotes) if (search(quote.text)) break;
    }
    return { origin: "fulltext", snippet };
  }

  return null;
}

export function entityMatchesSearch(entity: SearchEntity, rawQuery: string): boolean {
  return matchSearchEntity(entity, rawQuery) !== null;
}
