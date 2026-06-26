"""
关系抽取:把 character JSON 概要喂给 LLM → projects/<slug>/data/relations.json

策略:
  - 给 LLM 每人的 id + name_zh + category + epithet + bio 摘要 + events 标题
  - 让它输出 Relation[] —— 关系类型取自 project.config.json
  - 每条边带 1-6 个 event,尽量带文献出处(source 字段)

题材名取 config.title,关系类型取 config.relationTypes,名册取 sources.json。

用法:
  uv run extract_relations.py --project greek

决策:docs/design-freeze.md §2.3, §6 + 多项目重构
"""

from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path

from pydantic import ValidationError, TypeAdapter

sys.path.insert(0, str(Path(__file__).parent))
from schemas import Character, Relation  # noqa: E402
from project_io import add_project_arg, characters_dir, load_config, load_sources, relations_path  # noqa: E402
from llm_client import call_json  # noqa: E402

RelationListAdapter = TypeAdapter(list[Relation])


def build_system_prompt(domain: str, relation_hint: str) -> str:
    return f"""你是「{domain}」的族谱与事件关系学者。任务是基于已结构化的核心人物资料,输出他们之间的关系边数组。

**关系类型（primary_type 必须是其一）:**
{relation_hint}

**规则:**
1. 一对人物只产出**一条边**,按"最主导"的关系定 primary_type,其余进 composite_types。
2. **events 必须有内容**——至少 1 条,最多 6 条。每条 `{{title, desc, source?, era_order}}`。
3. **source 可选**,但若能溯源到该题材公认原典请尽量填,不要编造。
4. **era_order 从 0 起递增**——表示在他们关系中的时间序号。
5. **不要漏掉重要关系**。
6. **id 命名**:`{{source}}-{{target}}` 全小写,按字典序排列两个 slug。
7. **schema_version 固定为 2**。

**输出:严格的 JSON 数组（顶层）,元素是 Relation 对象。不要 ```json 围栏。**"""


def build_char_brief(char: Character) -> dict:
    return {
        "id": char.id,
        "name_zh": char.name_zh,
        "category": char.category,
        "era_layer": char.era_layer,
        "epithet": char.epithet,
        "bio": char.bio,
        "events": [{"title": e.title, "desc": e.desc[:120]} for e in char.events],
    }


def load_all_chars(char_dir: Path, sources: dict) -> list[Character]:
    chars = []
    for ch in sources["characters"]:
        p = char_dir / f"{ch['slug']}.json"
        if not p.exists():
            raise FileNotFoundError(f"缺少 {p}")
        chars.append(Character.model_validate_json(p.read_text(encoding="utf-8")))
    return chars


def main() -> None:
    ap = argparse.ArgumentParser()
    add_project_arg(ap)
    args = ap.parse_args()

    config = load_config(args.project)
    sources = load_sources(args.project)
    char_dir = characters_dir(args.project)
    out_path = relations_path(args.project)

    chars = load_all_chars(char_dir, sources)
    print(f"已载入 {len(chars)} 个人物")

    briefs = [build_char_brief(c) for c in chars]
    char_index = {c.id: c.name_zh for c in chars}
    relation_hint = "\n".join(f"- `{k}`  {v.label}" for k, v in config.relationTypes.items())
    system_prompt = build_system_prompt(config.title, relation_hint)

    user_prompt = f"""以下是已结构化的 {len(briefs)} 个「{config.title}」核心人物档案（精简版）。请基于这些资料产出他们之间的**完整关系图**,按 Relation schema 输出 JSON 数组。

**目标边数:与人物数量相当或略多**,每条都要有据可查。

**人物清单（id → name_zh）:**
{json.dumps(char_index, ensure_ascii=False, indent=2)}

---

**人物档案:**
{json.dumps(briefs, ensure_ascii=False, indent=2)}

---

请输出 JSON 数组。每个元素结构:
```
{{
  "schema_version": 2,
  "id": "a-b",
  "source": "a",
  "target": "b",
  "primary_type": "<上列之一>",
  "composite_types": [],
  "events": [
    {{"title": "...", "desc": "...", "source": {{"work": "...", "locus": "..."}}, "era_order": 0}}
  ]
}}
```

现在输出 JSON 数组:"""

    relations: list[Relation] = []
    for attempt in range(1, 4):
        try:
            print(f"\n调 LLM 抽关系（attempt {attempt}）...")
            data = call_json(system_prompt, user_prompt, max_tokens=16000)
            if not isinstance(data, list):
                raise ValueError(f"期望 list，得到 {type(data).__name__}")
            relations = RelationListAdapter.validate_python(data)
            break
        except ValidationError as e:
            errs = e.errors()[:3]
            err_summary = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in errs)
            print(f"  ⚠  schema 校验失败:{err_summary}")
            if attempt < 3:
                user_prompt += f"\n\n【上次输出校验失败:{err_summary}。请严格遵守 schema 重新输出。】"
                time.sleep(2)
            else:
                raise
        except Exception as e:
            print(f"  ⚠  {type(e).__name__}: {e}")
            if attempt < 3:
                time.sleep(3)
            else:
                raise

    by_type: dict[str, int] = {}
    for r in relations:
        by_type[r.primary_type] = by_type.get(r.primary_type, 0) + 1

    out_path.write_text(
        json.dumps([r.model_dump(mode="json") for r in relations], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✓ 输出 {len(relations)} 条关系 → {out_path}")
    print(f"  分类统计:{by_type}")


if __name__ == "__main__":
    main()
