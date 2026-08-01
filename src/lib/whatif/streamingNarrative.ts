interface PartialNarrativeSegment {
  label?: unknown;
  text?: unknown;
}

/**
 * 从尚未完成的根 JSON 中提取已闭合的 narrative 条目。
 * 不能对完整 raw 直接 JSON.parse，因为流式传输中最后一个条目通常未闭合。
 */
function completeNarrativeItems(raw: string): PartialNarrativeSegment[] {
  const narrativeMatch = /"narrative"\s*:\s*\[/.exec(raw);
  if (!narrativeMatch) return [];

  const items: PartialNarrativeSegment[] = [];
  let index = narrativeMatch.index + narrativeMatch[0].length;

  while (index < raw.length) {
    while (/\s|,/.test(raw[index] ?? "")) index += 1;
    if (raw[index] !== "{") break;

    const start = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let completeAt = -1;

    for (; index < raw.length; index += 1) {
      const character = raw[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          completeAt = index + 1;
          break;
        }
      }
    }

    if (completeAt < 0) break;
    try {
      const item = JSON.parse(raw.slice(start, completeAt));
      if (item && typeof item === "object" && !Array.isArray(item)) {
        items.push(item as PartialNarrativeSegment);
      }
    } catch {
      // 上游 JSON Schema 仍可能偶发不合规；等待最终本地 Zod 校验处理。
    }
    index = completeAt;
  }

  return items;
}

/**
 * Extracts completed, user-facing story paragraphs from the JSON streaming output.
 * The final parser remains authoritative; incomplete JSON never enters the visible stream.
 */
export function extractStreamingNarrative(raw: string): string {
  return completeNarrativeItems(raw)
    .flatMap(({ label, text }) => (
      typeof label === "string" && typeof text === "string" && text.trim()
        ? [`【${label}】${text}`]
        : []
    ))
    .join("\n");
}
