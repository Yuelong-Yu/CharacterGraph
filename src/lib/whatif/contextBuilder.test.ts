/**
 * contextBuilder 单元测试
 */
import { describe, it, expect } from "vitest";
import { buildContext, MAX_NODES } from "@/lib/whatif/contextBuilder";
import type { Dataset, Character, Relation, Artifact } from "@/schemas/character";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    schema_version: 3,
    id: "core",
    name_zh: "核心",
    name_en: "Core",
    aliases: [],
    epithet: null,
    category: "liangshan",
    era_layer: 1,
    bio: "核心人物",
    events: [{ title: "事件", desc: "x", source: null }],
    quotes: [],
    weapons: [],
    skills: [],
    domains: [],
    mounts: [],
    portrait: "",
    thumb: "",
    ...overrides,
  };
}

function makeRelation(source: string, target: string, type = "bond"): Relation {
  const [a, b] = [source, target].sort();
  return {
    schema_version: 3,
    id: `${a}-${b}`,
    source,
    target,
    primary_type: type,
    composite_types: [],
    events: [],
  };
}

function makeDataset(chars: Character[], rels: Relation[] = [], artifacts: Artifact[] = []): Dataset {
  return { schema_version: 3, characters: chars, artifacts, relations: rels };
}

describe("buildContext", () => {
  it("throws on unknown core character", () => {
    const ds = makeDataset([makeCharacter({ id: "a" })]);
    expect(() => buildContext(ds, "nonexistent")).toThrow("character not found");
  });

  it("core character info is fully included", () => {
    const core = makeCharacter({
      id: "core",
      name_zh: "宋江",
      bio: "宋江传记",
      events: [{ title: "怒杀阎婆惜", desc: "...", source: null }],
    });
    const ds = makeDataset([core]);
    const subset = buildContext(ds, "core");
    expect(subset.core.id).toBe("core");
    expect(subset.core.name_zh).toBe("宋江");
    expect(subset.core.bio).toBe("宋江传记");
    expect(subset.core.events).toHaveLength(1);
  });

  it("1度邻居 correctly identified", () => {
    const core = makeCharacter({ id: "core" });
    const n1 = makeCharacter({ id: "n1", name_zh: "邻居1" });
    const n2 = makeCharacter({ id: "n2", name_zh: "邻居2" });
    const unrelated = makeCharacter({ id: "x" });
    const rels = [makeRelation("core", "n1"), makeRelation("core", "n2")];
    const ds = makeDataset([core, n1, n2, unrelated], rels);
    const subset = buildContext(ds, "core");
    expect(subset.neighbors).toHaveLength(2);
    expect(subset.neighbors.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("1度邻居 includes relation info", () => {
    const core = makeCharacter({ id: "core" });
    const n1 = makeCharacter({ id: "n1" });
    const rel = makeRelation("core", "n1", "kinship");
    const ds = makeDataset([core, n1], [rel]);
    const subset = buildContext(ds, "core");
    expect(subset.neighbors[0].relation.primary_type).toBe("kinship");
  });

  it("2度邻居 identified (excluding core and 1度)", () => {
    const core = makeCharacter({ id: "core" });
    const n1 = makeCharacter({ id: "n1" });
    const n2 = makeCharacter({ id: "n2" }); // 2度：n1 的邻居
    const rels = [
      makeRelation("core", "n1"),
      makeRelation("n1", "n2"),
    ];
    const ds = makeDataset([core, n1, n2], rels);
    const subset = buildContext(ds, "core");
    expect(subset.secondDegree).toHaveLength(1);
    expect(subset.secondDegree[0].id).toBe("n2");
  });

  it("2度邻居 excludes core and 1度邻居", () => {
    const core = makeCharacter({ id: "core" });
    const n1 = makeCharacter({ id: "n1" });
    const rels = [
      makeRelation("core", "n1"),
      makeRelation("n1", "core"), // 反向连接回 core
    ];
    const ds = makeDataset([core, n1], rels);
    const subset = buildContext(ds, "core");
    expect(subset.secondDegree).toHaveLength(0);
  });

  it("artifacts related to core are included", () => {
    const core = makeCharacter({ id: "core" });
    const artifact: Artifact = {
      schema_version: 3,
      id: "weapon1",
      name_zh: "宝剑",
      name_en: "Sword",
      aliases: [],
      epithet: "神兵",
      category: "weapon",
      bio: null,
      events: [],
      domains: [],
      portrait: "",
      thumb: "",
    };
    const rel = makeRelation("core", "weapon1", "owns");
    const ds = makeDataset([core], [rel], [artifact]);
    const subset = buildContext(ds, "core");
    expect(subset.artifacts).toHaveLength(1);
    expect(subset.artifacts[0].id).toBe("weapon1");
  });

  it("enforces MAX_NODES=15 by trimming 1度邻居 when lower-priority nodes are absent", () => {
    const core = makeCharacter({ id: "core" });
    // 35 个 1度邻居 + 35 个 2度邻居
    const chars: Character[] = [core];
    const rels: Relation[] = [];
    for (let i = 0; i < 35; i++) {
      const n1 = makeCharacter({ id: `n1_${i}` });
      chars.push(n1);
      rels.push(makeRelation("core", `n1_${i}`));
    }
    const ds = makeDataset(chars, rels);
    const subset = buildContext(ds, "core");
    expect(MAX_NODES).toBe(15);
    // core(1) + neighbors(35) 超限；没有 2度或宝物时，必须裁 1度至 14。
    expect(subset.neighbors).toHaveLength(14);
    expect(1 + subset.neighbors.length + subset.secondDegree.length + subset.artifacts.length)
      .toBeLessThanOrEqual(MAX_NODES);
    expect(subset.core.id).toBe("core");
  });

  it("keeps 1度和宝物 before 2度节点 when applying the node budget", () => {
    const core = makeCharacter({ id: "core" });
    const n1 = Array.from({ length: 13 }, (_, index) => makeCharacter({ id: `n1_${index}` }));
    const n2 = Array.from({ length: 3 }, (_, index) => makeCharacter({ id: `n2_${index}` }));
    const artifact: Artifact = {
      schema_version: 3,
      id: "artifact_1",
      name_zh: "宝物",
      name_en: "Artifact",
      aliases: [],
      epithet: null,
      category: "weapon",
      bio: null,
      events: [],
      domains: [],
      portrait: "",
      thumb: "",
    };
    const rels = [
      ...n1.map((node) => makeRelation("core", node.id)),
      ...n2.map((node, index) => makeRelation(n1[index].id, node.id)),
      makeRelation("core", artifact.id, "owns"),
    ];

    const subset = buildContext(makeDataset([core, ...n1, ...n2], rels, [artifact]), "core");

    expect(subset.neighbors).toHaveLength(13);
    expect(subset.artifacts).toHaveLength(1);
    expect(subset.secondDegree).toHaveLength(0);
    expect(1 + subset.neighbors.length + subset.secondDegree.length + subset.artifacts.length)
      .toBe(MAX_NODES);
  });

  it("keeps branch-added characters outside the canonical node budget", () => {
    const core = makeCharacter({ id: "core" });
    const canonicalNeighbors = Array.from({ length: 20 }, (_, index) => (
      makeCharacter({ id: `canon_${index}` })
    ));
    const branchNeighbors = Array.from({ length: 4 }, (_, index) => (
      makeCharacter({ id: `branch_${index}`, name_zh: `分支人物${index}` })
    ));
    const disconnectedBranchCharacter = makeCharacter({
      id: "branch_far",
      name_zh: "远方分支人物",
      bio: "由本分支新增，尚未与核心人物建立关系。",
    });
    const allCharacters = [core, ...canonicalNeighbors, ...branchNeighbors, disconnectedBranchCharacter];
    const relations = [
      ...canonicalNeighbors.map((character) => makeRelation("core", character.id)),
      ...branchNeighbors.map((character) => makeRelation("core", character.id)),
    ];

    const subset = buildContext(
      makeDataset(allCharacters, relations),
      "core",
      { branchCharacterIds: new Set([...branchNeighbors.map((character) => character.id), "branch_far"]) },
    );

    expect(subset.neighbors.filter((node) => node.id.startsWith("branch_"))).toHaveLength(4);
    expect(subset.branchAddedCharacters.map((character) => character.id).sort())
      .toEqual(["branch_0", "branch_1", "branch_2", "branch_3", "branch_far"]);
    expect(subset.branchAddedCharacters.find((character) => character.id === "branch_far")?.bio)
      .toContain("本分支新增");
    expect(subset.branchAddedRelations.map((relation) => relation.id))
      .toContain("branch_0-core");

    const canonicalBudget = 1
      + subset.neighbors.filter((node) => !node.id.startsWith("branch_")).length
      + subset.secondDegree.filter((node) => !node.id.startsWith("branch_")).length
      + subset.artifacts.length;
    expect(canonicalBudget).toBeLessThanOrEqual(MAX_NODES);
  });
});
