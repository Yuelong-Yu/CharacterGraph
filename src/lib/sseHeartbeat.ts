export const SSE_HEARTBEAT_FRAME = ": heartbeat\n\n";

/** Keeps a long-lived SSE response active while upstream work is in progress. */
export function startSseHeartbeat(
  send: (frame: string) => void,
  intervalMs = 10_000,
): () => void {
  const timer = setInterval(() => send(SSE_HEARTBEAT_FRAME), intervalMs);
  return () => clearInterval(timer);
}
