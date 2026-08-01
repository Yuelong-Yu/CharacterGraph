/**
 * Send SSE comments while an upstream generation is quiet. Comments are ignored
 * by EventSource parsers but make proxies flush the response and keep it open.
 */
export function startSSEKeepAlive(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  intervalMs = 15_000,
): () => void {
  const write = () => controller.enqueue(encoder.encode(": keepalive\n\n"));
  write();
  const timer = setInterval(write, intervalMs);
  return () => clearInterval(timer);
}
