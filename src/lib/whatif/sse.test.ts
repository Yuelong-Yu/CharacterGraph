import { afterEach, describe, expect, it, vi } from "vitest";
import { startSSEKeepAlive } from "@/lib/whatif/sse";

describe("startSSEKeepAlive", () => {
  afterEach(() => vi.useRealTimers());

  it("writes immediately and keeps an idle SSE response alive", () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const controller = {
      enqueue: (chunk: Uint8Array) => chunks.push(new TextDecoder().decode(chunk)),
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    const stop = startSSEKeepAlive(controller, new TextEncoder(), 15_000);

    expect(chunks).toEqual([": keepalive\n\n"]);
    vi.advanceTimersByTime(30_000);
    expect(chunks).toEqual([": keepalive\n\n", ": keepalive\n\n", ": keepalive\n\n"]);

    stop();
    vi.advanceTimersByTime(30_000);
    expect(chunks).toHaveLength(3);
  });
});
