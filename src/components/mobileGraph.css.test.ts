import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  fileURLToPath(new URL("./mobileGraph.css", import.meta.url)),
  "utf8",
);
const mobileGraphView = readFileSync(
  fileURLToPath(new URL("./MobileGraphView.tsx", import.meta.url)),
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

describe("mobile theme browser compatibility", () => {
  it("uses legacy color values for the event accent and divider", () => {
    const variables = mobileGraphView.match(/const mobileVariables = \{(?<declarations>[\s\S]*?)\n\} as React\.CSSProperties;/)?.groups?.declarations;

    expect(variables).toBeDefined();
    expect(variables).not.toMatch(/"--mobile-[^"]+":\s*"oklch\(/i);
    expect(variables).toMatch(/"--mobile-accent":\s*"#[0-9a-f]{6}"/i);
    expect(variables).toMatch(/"--mobile-border":\s*"#[0-9a-f]{6}"/i);
  });
});
