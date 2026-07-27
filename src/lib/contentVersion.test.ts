import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { versionFileUrl } from "@/lib/contentVersion";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("versionFileUrl", () => {
  it("changes the URL when a file at the same path gets new content", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "charactergraph-content-version-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "portrait.webp");

    fs.writeFileSync(filePath, "first");
    expect(versionFileUrl("/p/example/portrait.webp", filePath)).toBe(
      "/p/example/portrait.webp?v=a7937b64b8caa58f",
    );

    fs.writeFileSync(filePath, "second");
    expect(versionFileUrl("/p/example/portrait.webp", filePath)).toBe(
      "/p/example/portrait.webp?v=16367aacb67a4a01",
    );
  });
});
