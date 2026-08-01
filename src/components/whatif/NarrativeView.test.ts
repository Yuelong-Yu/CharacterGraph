import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./NarrativeView.tsx", import.meta.url)),
  "utf8",
);

describe("NarrativeView streaming placeholder", () => {
  it("keeps the story area empty until narrative content is available", () => {
    expect(source).not.toContain("正在生成故事...");
    expect(source).toContain("if (!visibleNarrative) return null;");
  });
});
