import { describe, expect, it, vi } from "vitest";
import { SSE_HEARTBEAT_FRAME, startSseHeartbeat } from "@/lib/sseHeartbeat";

describe("startSseHeartbeat", () => {
  it("keeps an SSE stream active until it is explicitly stopped", () => {
    vi.useFakeTimers();
    const send = vi.fn();

    const stop = startSseHeartbeat(send, 10_000);
    vi.advanceTimersByTime(20_000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(SSE_HEARTBEAT_FRAME);

    stop();
    vi.advanceTimersByTime(20_000);
    expect(send).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
