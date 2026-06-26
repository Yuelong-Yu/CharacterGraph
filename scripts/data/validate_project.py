"""项目数据校验器:加载某项目的 config + 数据,做 schema 校验 + 分类/关系合法性 + 悬挂 id 检查。

用法:
    uv run validate_project.py --project greek
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path

from schemas import (
    Artifact,
    Character,
    Dataset,
    ProjectConfig,
    Relation,
    validate_against_config,
)

ROOT = Path(__file__).resolve().parents[2]


def load_project(slug: str) -> tuple[ProjectConfig, Dataset]:
    base = ROOT / "projects" / slug
    if not base.is_dir():
        sys.exit(f"项目不存在: {base}")

    config = ProjectConfig.model_validate_json((base / "project.config.json").read_text("utf-8"))

    characters = [
        Character.model_validate_json(Path(f).read_text("utf-8"))
        for f in sorted(glob.glob(str(base / "data" / "characters" / "*.json")))
    ]
    artifacts = [
        Artifact.model_validate_json(Path(f).read_text("utf-8"))
        for f in sorted(glob.glob(str(base / "data" / "artifacts" / "*.json")))
    ]
    rel_raw = json.loads((base / "data" / "relations.json").read_text("utf-8"))
    rel_arr = rel_raw if isinstance(rel_raw, list) else rel_raw.get("relations", [])
    relations = [Relation.model_validate(r) for r in rel_arr]

    dataset = Dataset(
        schema_version=config.schema_version,
        characters=characters,
        artifacts=artifacts,
        relations=relations,
    )
    return config, dataset


def check_dangling(dataset: Dataset) -> list[str]:
    ids = {c.id for c in dataset.characters} | {a.id for a in dataset.artifacts}
    errors = []
    seen_rel = set()
    for r in dataset.relations:
        if r.id in seen_rel:
            errors.append(f"relation id 重复: {r.id}")
        seen_rel.add(r.id)
        if r.source not in ids:
            errors.append(f"relation[{r.id}] source 悬挂: {r.source}")
        if r.target not in ids:
            errors.append(f"relation[{r.id}] target 悬挂: {r.target}")
    return errors


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="项目 slug,如 greek")
    args = ap.parse_args()

    config, dataset = load_project(args.project)
    errors = validate_against_config(dataset, config) + check_dangling(dataset)

    print(
        f"[{args.project}] characters={len(dataset.characters)} "
        f"artifacts={len(dataset.artifacts)} relations={len(dataset.relations)}"
    )
    print(
        f"  config: charCats={len(config.characterCategories)} "
        f"artCats={len(config.artifactCategories)} relTypes={len(config.relationTypes)}"
    )
    if errors:
        print(f"\n校验失败,{len(errors)} 个问题:")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    print("\n✓ 全部通过")


if __name__ == "__main__":
    main()
