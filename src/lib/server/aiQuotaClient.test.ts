import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmWhatIfQuota,
  reserveWhatIfQuota,
} from "@/lib/server/aiQuotaClient";

function requestWithCookie(cookie = "chron_user=signed-session") {
  return { headers: new Headers({ cookie }) } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CharacterGraph AI quota client", () => {
  it("forwards the shared auth cookie and reserves the whole batch in one call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_QUOTA_SERVICE_SECRET", "test-quota-secret");
    vi.stubEnv("CHRONCHAOS_INTERNAL_ORIGIN", "http://chronchaos.internal/");

    await reserveWhatIfQuota(
      requestWithCookie(),
      ["regen:turn-1", "regen:turn-2"],
      "user_character_regeneration",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://chronchaos.internal/api/internal/ai-generation-quota");
    expect(new Headers(init.headers).get("cookie")).toBe("chron_user=signed-session");
    expect(new Headers(init.headers).get("x-ai-quota-service-secret")).toBe("test-quota-secret");
    expect(JSON.parse(String(init.body))).toEqual({
      action: "reserve",
      requestKeys: ["regen:turn-1", "regen:turn-2"],
      operation: "user_character_regeneration",
    });
  });

  it("preserves the quota failure code used to open the upgrade dialog", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { ok: false, error: "请升级权限后继续。", code: "UPGRADE_REQUIRED" },
      { status: 403 },
    )));

    await expect(reserveWhatIfQuota(
      requestWithCookie(),
      ["whatif:turn-1"],
      "whatif_initial",
    )).rejects.toMatchObject({
      code: "UPGRADE_REQUIRED",
      status: 403,
      message: "请升级权限后继续。",
    });
  });

  it("retries confirmation without reserving or counting another unit", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await confirmWhatIfQuota(requestWithCookie(), ["whatif:turn-1"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(JSON.parse(String(init.body))).toEqual({
        action: "confirm",
        requestKeys: ["whatif:turn-1"],
      });
    }
  });
});
