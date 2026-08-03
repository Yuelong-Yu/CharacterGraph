import { afterEach, describe, expect, it, vi } from "vitest";
import { streamWhatIf } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamWhatIf", () => {
  it("reports the session id from the response before consuming streamed events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", { headers: { "X-WhatIf-Session-Id": "session-recoverable" } }),
      ),
    );
    const sessionIds: string[] = [];

    await streamWhatIf(
      {
        projectSlug: "greek",
        title: "test",
        characterId: "odysseus",
        premise: "test premise",
        premiseType: "free_text",
      },
      {
        onSession: (sessionId) => sessionIds.push(sessionId),
        onDelta: () => {},
        onReset: () => {},
        onDone: () => {},
        onError: () => {},
      },
    );

    expect(sessionIds).toEqual(["session-recoverable"]);
  });

  it("forwards server generation stages before streamed text", async () => {
    const body = [
      "event: status\ndata: {\"stage\":\"thinking\"}\n\n",
      "event: status\ndata: {\"stage\":\"generating\"}\n\n",
      "event: delta\ndata: {\"text\":\"正文\"}\n\n",
    ].join("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const stages: string[] = [];
    const deltas: string[] = [];

    await streamWhatIf(
      {
        projectSlug: "greek",
        title: "test",
        characterId: "odysseus",
        premise: "test premise",
        premiseType: "free_text",
      },
      {
        onStatus: (stage) => stages.push(stage),
        onDelta: (text) => deltas.push(text),
        onReset: () => {},
        onDone: () => {},
        onError: () => {},
      },
    );

    expect(stages).toEqual(["thinking", "generating"]);
    expect(deltas).toEqual(["正文"]);
  });
});
