import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ValidationResults.tsx", import.meta.url)),
  "utf8",
);

describe("ValidationResults warnings", () => {
  it("uses the same yellow as the 杜撰 narrative label", () => {
    expect(source).toContain('const WARNING_COLOR = "#ff8c00";');
  });
});
