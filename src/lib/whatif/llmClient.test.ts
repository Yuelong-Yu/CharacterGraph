import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicMock {
    messages = { create: createMock };
  },
}));

function eventStream(texts: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of texts) {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        };
      }
    },
  };
}

describe("callLLMStream", () => {
  beforeEach(() => {
    createMock.mockReset();
    vi.resetModules();
    vi.stubEnv("CODING_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retries once when the provider completes without text", async () => {
    createMock
      .mockResolvedValueOnce(eventStream([]))
      .mockResolvedValueOnce(eventStream(["OK"]));
    const { callLLMStream } = await import("@/lib/whatif/llmClient");
    const deltas: string[] = [];

    await callLLMStream("system", "user", 32, (delta) => deltas.push(delta));

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(deltas).toEqual(["OK"]);
  });

  it("notifies the consumer to discard partial text before a transport retry", async () => {
    const partialThenError = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "partial" },
        };
        throw new Error("ECONNRESET");
      },
    };
    createMock
      .mockResolvedValueOnce(partialThenError)
      .mockResolvedValueOnce(eventStream(["complete"]));
    const { callLLMStream } = await import("@/lib/whatif/llmClient");
    let text = "";
    let resetCount = 0;

    await callLLMStream(
      "system",
      "user",
      32,
      (delta) => { text += delta; },
      () => { text = ""; resetCount += 1; },
    );

    expect(resetCount).toBe(1);
    expect(text).toBe("complete");
  });
});

describe("generateParsedWhatIf", () => {
  beforeEach(() => {
    createMock.mockReset();
    vi.resetModules();
    vi.stubEnv("CODING_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("regenerates once when the first complete response cannot be parsed", async () => {
    const invalid = `===DIFF===\n{not-json}\n===NARRATIVE===\n【推演】失败草稿\n===CHOICES===\n1. 失败选项`;
    const valid = `===DIFF===
{"removedNodes":[],"addedNodes":[],"removedEdges":[],"addedEdges":[],"modifiedEvents":[],"replacedEvents":[]}
===NARRATIVE===
【推演】第二次生成成功。
===CHOICES===
1. 继续推演`;
    createMock
      .mockResolvedValueOnce(eventStream([invalid]))
      .mockResolvedValueOnce(eventStream([valid]));
    const { generateParsedWhatIf } = await import("@/lib/whatif/llmClient");
    let streamed = "";
    let resetCount = 0;

    const result = await generateParsedWhatIf(
      "system",
      "user",
      256,
      (delta) => { streamed += delta; },
      () => { streamed = ""; resetCount += 1; },
    );

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(resetCount).toBe(1);
    expect(streamed).toBe(valid);
    expect(result.choices).toEqual(["继续推演"]);
  });
});
