"""
从 sources.json 的 owns 声明生成 owns 关系边,合并进 relations.json。

owns 是确定性的"人物→器物"已知映射(不经 LLM,不杜撰),声明于
projects/<slug>/sources.json 的 "owns" 数组,每项:
  {owner, artifact, canon?, title, desc, work?, locus?}

仅当 owner(characters/) 与 artifact(artifacts/) 的 JSON 均存在时才生成该边,
缺失则跳过(器物后补后重跑即自动补齐)。幂等:已存在同 id 的边不重复添加。

用法:
  uv run build_owns.py --project sanguo
"""

from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from project_io import (  # noqa: E402
    add_project_arg, artifacts_dir, characters_dir, load_sources, relations_path,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    add_project_arg(ap)
    args = ap.parse_args()

    sources = load_sources(args.project)
    owns = sources.get("owns", [])
    if not owns:
        print("sources.json 无 owns 声明,跳过")
        return

    char_dir = characters_dir(args.project)
    art_dir = artifacts_dir(args.project)
    rel_path = relations_path(args.project)

    relations = json.loads(rel_path.read_text(encoding="utf-8")) if rel_path.exists() else []
    existing_ids = {r["id"] for r in relations}

    added, skipped = 0, []
    for o in owns:
        owner, artifact = o["owner"], o["artifact"]
        rid = f"{owner}-{artifact}"
        if rid in existing_ids:
            continue
        if not (char_dir / f"{owner}.json").exists():
            skipped.append(f"{rid}(缺人物)")
            continue
        if not (art_dir / f"{artifact}.json").exists():
            skipped.append(f"{rid}(缺器物)")
            continue
        event = {
            "title": o["title"],
            "desc": o["desc"],
            "desc_long": None,
            "source": {"work": o.get("work", ""), "locus": o.get("locus"), "translator": None},
            "canon": o.get("canon"),
            "era_order": 0,
        }
        relations.append({
            "schema_version": 3,
            "id": rid,
            "source": owner,
            "target": artifact,
            "primary_type": "owns",
            "composite_types": [],
            "events": [event],
        })
        existing_ids.add(rid)
        added += 1

    rel_path.write_text(json.dumps(relations, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"owns 边:新增 {added},现共 {len(relations)} 条关系")
    if skipped:
        print(f"跳过(待补):{skipped}")


if __name__ == "__main__":
    main()
