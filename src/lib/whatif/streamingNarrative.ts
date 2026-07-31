const NARRATIVE_SEPARATOR = "===NARRATIVE===";
const CONTROL_SEPARATORS = [
  "===CHOICES===",
  "===DIFF===",
  NARRATIVE_SEPARATOR,
] as const;

function removeTrailingSeparatorPrefix(text: string): string {
  for (const separator of CONTROL_SEPARATORS) {
    for (let length = separator.length - 1; length > 0; length--) {
      const prefix = separator.slice(0, length);
      if (text.endsWith(prefix)) {
        return text.slice(0, -length);
      }
    }
  }
  return text;
}

/**
 * Extracts the user-facing story from the model's structured streaming output.
 * DIFF, control separators, and choices remain available to the final parser but
 * never enter the visible stream.
 */
export function extractStreamingNarrative(raw: string): string {
  const narrativeStart = raw.indexOf(NARRATIVE_SEPARATOR);
  if (narrativeStart < 0) return "";

  const contentStart = narrativeStart + NARRATIVE_SEPARATOR.length;
  let narrative = raw.slice(contentStart);

  const boundaryIndexes = CONTROL_SEPARATORS
    .map((separator) => narrative.indexOf(separator))
    .filter((index) => index >= 0);
  if (boundaryIndexes.length > 0) {
    narrative = narrative.slice(0, Math.min(...boundaryIndexes));
  } else {
    narrative = removeTrailingSeparatorPrefix(narrative);
  }

  return narrative.replace(/^\s+/, "");
}
