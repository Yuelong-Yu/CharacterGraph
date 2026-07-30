import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listProjects, loadDataset } from "@/lib/data";

const CONTENT_VERSION_PATTERN = /[?&]v=[a-f0-9]{16}(?:&|$)/;

describe("project asset URLs", () => {
  it("uses the highest-degree character portrait when no explicit cover exists", () => {
    for (const project of listProjects()) {
      const explicitCover = path.join(process.cwd(), "projects", project.slug, "images", "cover.webp");
      if (fs.existsSync(explicitCover)) continue;

      const { dataset } = loadDataset(project.slug);
      const degreeById = new Map(dataset.characters.map((character) => [character.id, 0]));
      for (const relation of dataset.relations) {
        if (degreeById.has(relation.source)) {
          degreeById.set(relation.source, (degreeById.get(relation.source) ?? 0) + 1);
        }
        if (degreeById.has(relation.target)) {
          degreeById.set(relation.target, (degreeById.get(relation.target) ?? 0) + 1);
        }
      }

      const highestDegreeCharacter = dataset.characters.toSorted((a, b) => {
        const degreeDifference = (degreeById.get(b.id) ?? 0) - (degreeById.get(a.id) ?? 0);
        return degreeDifference || a.id.localeCompare(b.id);
      })[0];

      expect(project.cover).toBe(highestDegreeCharacter?.portrait ?? null);
    }
  });

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
