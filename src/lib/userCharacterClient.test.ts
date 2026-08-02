import { afterEach, describe, expect, it, vi } from "vitest";
import { streamUserCharacterGeneration } from "@/lib/userCharacterClient";

const input = {
  projectSlug: "greek",
  nameZh: "测试人物",
  background: "测试背景",
  category: "achaean",
  eraLayer: 4,
  aliases: [],
  epithet: null,
  relationCount: 0,
  requiredCharacterIds: [],
  candidates: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("streamUserCharacterGeneration", () => {
  it("retries one interrupted SSE transport and returns the recovered preview", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(new Response([
        "event: done",
        "data: {\"profile\":{\"nameEn\":\"Test\",\"aliases\":[],\"epithet\":null,\"bio\":\"bio\",\"events\":[],\"weapons\":[],\"skills\":[],\"domains\":[],\"mounts\":[]},\"relationships\":[],\"sourceWork\":\"test\"}",
        "",
        "",
      ].join("\n"), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const progress = vi.fn();
    const done = vi.fn();

    await streamUserCharacterGeneration(input, {
      onProgress: progress,
      onDone: done,
      onError: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledWith({ stage: "reconnecting", completed: 0, total: 1 });
    expect(done).toHaveBeenCalledTimes(1);
  });
});
