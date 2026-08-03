/**
 * Send SSE comments while an upstream generation is quiet. Comments are ignored
 * by EventSource parsers but make proxies flush the response and keep it open.
 */
export function startSSEKeepAlive(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  intervalMs = 15_000,
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const write = () => {
    try {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
    } catch {
      if (timer) clearInterval(timer);
    }
  };
  write();
  timer = setInterval(write, intervalMs);
  return () => timer && clearInterval(timer);
}
