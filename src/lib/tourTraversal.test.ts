import { describe, expect, it } from "vitest";

import { buildTourSequence } from "./tourTraversal";

const nodes = [
  { id: "hub" },
  { id: "alpha" },
  { id: "beta" },
  { id: "alpha-leaf" },
  { id: "beta-leaf" },
  { id: "artifact" },
];

const relations = [
  { source: "hub", target: "alpha" },
  { source: "hub", target: "beta" },
  { source: "alpha", target: "alpha-leaf" },
  { source: "beta", target: "beta-leaf" },
  { source: "alpha-leaf", target: "artifact" },
];

const degreeById = new Map([
  ["hub", 10],
  ["alpha", 7],
  ["beta", 5],
  ["alpha-leaf", 3],
  ["beta-leaf", 2],
  ["artifact", 1],
]);

describe("buildTourSequence", () => {
  it("visits visible nodes breadth-first with higher-degree peers first", () => {
    const sequence = buildTourSequence({
      nodes,
      relations,
      visibleIds: new Set(nodes.map((node) => node.id)),
      degreeById,
      mode: "breadth-first",
    });

    expect(sequence.map((node) => node.id)).toEqual([
      "hub",
      "alpha",
      "beta",
      "alpha-leaf",
      "beta-leaf",
      "artifact",
    ]);
  });

  it("visits visible nodes depth-first with higher-degree branches first", () => {
    const sequence = buildTourSequence({
      nodes,
      relations,
      visibleIds: new Set(nodes.map((node) => node.id)),
      degreeById,
      mode: "depth-first",
    });

    expect(sequence.map((node) => node.id)).toEqual([
      "hub",
      "alpha",
      "alpha-leaf",
      "artifact",
      "beta",
      "beta-leaf",
    ]);
  });
});
