import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  fileURLToPath(new URL("./mobileGraph.css", import.meta.url)),
  "utf8",
);

describe("mobile detail sheet background", () => {
  it("uses an opaque literal fallback instead of the oklch theme variable", () => {
    const sheetRule = stylesheet.match(/\.mobile-detail-sheet\s*\{(?<declarations>[^}]*)}/)?.groups?.declarations;

    expect(sheetRule).toBeDefined();
    expect(sheetRule).toMatch(/background:\s*#fff\s*;/);
    expect(sheetRule).not.toMatch(/background:\s*var\(--mobile-panel/);
  });
});
