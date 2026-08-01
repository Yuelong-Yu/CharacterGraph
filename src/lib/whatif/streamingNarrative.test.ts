import { describe, expect, it } from "vitest";
import { extractStreamingNarrative } from "./streamingNarrative";

describe("extractStreamingNarrative", () => {
  it("keeps the stream empty until a narrative item is complete", () => {
    const raw = '{"narrative":[{"label":"推演","text":"奥德修斯改变';

    expect(extractStreamingNarrative(raw)).toBe("");
  });

  it("renders completed narrative objects and hides diff/choices", () => {
    const raw = `{
      "narrative": [
        {"label":"原典","text":"奥德修斯终将返乡。"},
        {"label":"推演","text":"他改变了返乡的路线。"}
      ],
      "diff": {"removedNodes": []},
      "choices": ["继续"]
    }`;

    expect(extractStreamingNarrative(raw)).toBe(
      "【原典】奥德修斯终将返乡。\n【推演】他改变了返乡的路线。",
    );
  });

  it("handles escaped quotes in a completed narrative string", () => {
    const raw = '{"narrative":[{"label":"假设","text":"他说：\\"继续前进\\"。"}],"diff":';

    expect(extractStreamingNarrative(raw)).toBe("【假设】他说：\"继续前进\"。");
  });
});
