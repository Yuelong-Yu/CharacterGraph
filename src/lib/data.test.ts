import { describe, expect, it } from "vitest";
import { listProjects, loadDataset } from "@/lib/data";

const CONTENT_VERSION_PATTERN = /[?&]v=[a-f0-9]{16}(?:&|$)/;

describe("project asset URLs", () => {
  it("content-versions every bundled cover, portrait, and thumbnail", () => {
    const projects = listProjects();
    const urls = projects.flatMap((project) => {
      const { dataset } = loadDataset(project.slug);
      return [
        project.cover,
        ...dataset.characters.flatMap((character) => [character.portrait, character.thumb]),
        ...dataset.artifacts.flatMap((artifact) => [artifact.portrait, artifact.thumb]),
      ].filter((url): url is string => Boolean(url));
    });

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, `missing content version: ${url}`).toMatch(CONTENT_VERSION_PATTERN);
    }
  });
});
