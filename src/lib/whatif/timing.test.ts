import { describe, expect, it, vi } from "vitest";
import { createWhatIfTiming } from "./timing";

describe("createWhatIfTiming", () => {
  it("reports named stage durations and a total", () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(140).mockReturnValueOnce(180);
    const timing = createWhatIfTiming("initial", now);

    timing.mark("preparationMs", 120);
    const record = timing.report("success", { outputChars: 42 });

    expect(record).toMatchObject({
      operation: "initial",
      outcome: "success",
      preparationMs: 20,
      totalMs: 80,
      outputChars: 42,
    });
  });
});
