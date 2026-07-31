import { describe, expect, it } from "vitest";
import { extractStreamingNarrative } from "./streamingNarrative";

describe("extractStreamingNarrative", () => {
  it("hides diff output until the narrative section starts", () => {
    const raw = `===DIFF===
{
  "removedNodes": [],
  "addedNodes": []
}`;

    expect(extractStreamingNarrative(raw)).toBe("");
  });

  it("returns only the narrative section", () => {
    const raw = `===DIFF===
{"removedNodes":[]}
===NARRATIVE===
【推演】奥德修斯改变了返乡的路线。
===CHOICES===
1. 继续前行`;

    expect(extractStreamingNarrative(raw)).toBe("【推演】奥德修斯改变了返乡的路线。\n");
  });

  it("holds back a partially streamed choices separator", () => {
    const raw = `===DIFF===
{}
===NARRATIVE===
【推演】故事仍在继续。
===CHOI`;

    expect(extractStreamingNarrative(raw)).toBe("【推演】故事仍在继续。\n");
  });

  it("supports narrative separator text split across stream chunks", () => {
    expect(extractStreamingNarrative("===DIFF===\n{}\n===NARR")).toBe("");
    expect(
      extractStreamingNarrative("===DIFF===\n{}\n===NARRATIVE===\n【假设】新的前提成立。"),
    ).toBe("【假设】新的前提成立。");
  });
});
