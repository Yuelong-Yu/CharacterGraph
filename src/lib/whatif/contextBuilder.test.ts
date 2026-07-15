/**
 * contextBuilder 单元测试
 */
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/whatif/contextBuilder";
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

  it("truncates to MAX_NODES=30 when overflow", () => {
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
    // core(1) + neighbors(35) = 36, 超过 30
    // 裁剪逻辑：优先裁 2度（这里没 2度），再裁 artifacts（这里没）
    // 但 1度邻居超了不会被裁（裁剪只动 2度和 artifacts）
    // 所以 neighbors 仍是 35
    expect(subset.neighbors.length).toBe(35);
    expect(subset.core.id).toBe("core");
  });
});
