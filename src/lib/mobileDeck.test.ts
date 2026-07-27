import { describe, expect, it } from "vitest";

import { buildMobileDeck, filterMobileDeck, moveInMobileDeck } from "./mobileDeck";

describe("buildMobileDeck", () => {
  it("orders characters and artifacts in one breadth-first deck", () => {
    const nodes = [
      { id: "hero" },
      { id: "ally" },
      { id: "relic" },
      { id: "witness" },
      { id: "outsider" },
    ];
    const relations = [
      { source: "hero", target: "ally" },
      { source: "hero", target: "relic" },
      { source: "hero", target: "witness" },
      { source: "ally", target: "outsider" },
    ];

    expect(buildMobileDeck({ nodes, relations }).map((node) => node.id)).toEqual([
      "hero",
      "ally",
      "relic",
      "witness",
      "outsider",
    ]);
  });

  it("keeps the full BFS relative order when search filtering is applied", () => {
    const deck = [
      { id: "hero" },
      { id: "ally" },
      { id: "relic" },
      { id: "outsider" },
    ];

    expect(filterMobileDeck(deck, new Set(["relic", "hero"])).map((node) => node.id))
      .toEqual(["hero", "relic"]);
  });

  it("wraps in both directions", () => {
    const deck = [{ id: "hero" }, { id: "ally" }, { id: "relic" }];

    expect(moveInMobileDeck(deck, "relic", 1)?.id).toBe("hero");
    expect(moveInMobileDeck(deck, "hero", -1)?.id).toBe("relic");
  });
});
