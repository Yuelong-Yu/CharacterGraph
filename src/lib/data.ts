/**
 * 数据加载：从 /data/characters/*.json、/data/artifacts/*.json 和 /data/relations.json 读出整个 Dataset
 *
 * 服务端运行（在 Server Component / generateStaticParams 阶段）→ 文件系统直读。
 * 客户端运行时通过 props/JSON 传递，不直接 import。
 */
import fs from "node:fs";
import path from "node:path";
import { Artifact, Character, Relation, Dataset, SCHEMA_VERSION } from "@/schemas/character";

const DATA_DIR = path.join(process.cwd(), "data");
const CHAR_DIR = path.join(DATA_DIR, "characters");
const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");
const REL_PATH = path.join(DATA_DIR, "relations", "relations.json");

export function loadDataset(): Dataset {
  const characters = loadCharacters();
  const artifacts = loadArtifacts();
  const relations = loadRelations();
  return Dataset.parse({
    schema_version: SCHEMA_VERSION,
    characters,
    artifacts,
    relations,
  });
}

function loadCharacters(): Character[] {
  if (!fs.existsSync(CHAR_DIR)) return [];
  const files = fs.readdirSync(CHAR_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, f), "utf-8"));
    return Character.parse(raw);
  });
}

function loadArtifacts(): Artifact[] {
  if (!fs.existsSync(ARTIFACT_DIR)) return [];
  const files = fs.readdirSync(ARTIFACT_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIR, f), "utf-8"));
    return Artifact.parse(raw);
  });
}

function loadRelations(): Relation[] {
  if (!fs.existsSync(REL_PATH)) return [];
  const raw = JSON.parse(fs.readFileSync(REL_PATH, "utf-8"));
  // relations.json 可能直接是数组，也可能是 {relations: [...]}
  const arr = Array.isArray(raw) ? raw : raw.relations ?? [];
  return arr.map((r: unknown) => Relation.parse(r));
}
