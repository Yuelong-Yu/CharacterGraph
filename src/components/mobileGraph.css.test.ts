import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  fileURLToPath(new URL("./mobileGraph.css", import.meta.url)),
  "utf8",
);

describe("mobile detail sheet color fallback", () => {
  it("keeps an opaque white background when the theme color is unsupported", () => {
    const sheetRule = stylesheet.match(/\.mobile-detail-sheet\s*\{(?<declarations>[^}]*)}/)?.groups?.declarations;

    expect(sheetRule).toBeDefined();
    expect(sheetRule).toMatch(
      /background:\s*#fff\s*;\s*background:\s*var\(--mobile-panel\)\s*;/,
    );
  });
});
