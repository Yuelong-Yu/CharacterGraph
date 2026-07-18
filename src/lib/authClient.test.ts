import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchSessionUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads the session through the configured CharacterGraph base path", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/character-graph");
    const user = {
      id: "river-id",
      username: "River",
      displayName: "River",
      role: "reader",
      readerId: "river-reader",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchSessionUser } = await import("@/lib/authClient");

    await expect(fetchSessionUser()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith(
      "/character-graph/api/auth/me",
      { cache: "no-store" },
    );
  });

  it("returns null when the session endpoint rejects the request", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/character-graph");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Not found" }),
    }));

    const { fetchSessionUser } = await import("@/lib/authClient");

    await expect(fetchSessionUser()).resolves.toBeNull();
  });
});
