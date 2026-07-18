import type { SessionUser } from "@/lib/auth";
import { withBasePath } from "@/lib/basePath";

/**
 * Reads the shared ChronChaos session through CharacterGraph's own verifier.
 *
 * Using this single, base-path-aware endpoint keeps every CharacterGraph
 * surface on the same auth source even when the app is mounted below
 * `/character-graph`.
 */
export async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch(withBasePath("/api/auth/me"), { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { user?: SessionUser | null };
  return response.ok ? payload.user ?? null : null;
}
