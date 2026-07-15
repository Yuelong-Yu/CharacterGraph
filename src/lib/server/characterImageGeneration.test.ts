import { describe, expect, it } from "vitest";
import { runProcessWithTimeout } from "@/lib/server/characterImageGeneration";

describe("runProcessWithTimeout", () => {
  it("terminates a stalled image subprocess within the configured deadline", async () => {
    const startedAt = Date.now();
    await expect(runProcessWithTimeout(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10_000)"],
      { cwd: process.cwd(), stdin: "", timeoutMs: 30 },
    )).rejects.toMatchObject({ name: "ImageGenerationTimeoutError" });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
