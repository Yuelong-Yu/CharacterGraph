"""
关系抽取：把 18 个 character JSON 概要喂给 LLM → data/relations/relations.json

策略：
  - 给 LLM 18 人的 id + name_zh + category + epithet + bio 摘要 + events 标题
  - 让它输出 Relation[] —— 涵盖血缘/婚姻/敌对/同伴/师徒 5 类
  - 每条边带 1-4 个 event，每个 event 必须能用古典文献溯源（source 字段）

LLM 一次性产出全部边（18 人 × ~17 对/人 ≈ 153 潜在对，但实际有关系的 ~40-80 条）。

决策：docs/design-freeze.md §2.3, §6 (关系 5 类)
"""

from __future__ import annotations
import json
import sys
import time
from pathlib import Path

from pydantic import ValidationError, TypeAdapter

sys.path.insert(0, str(Path(__file__).parent))
from schemas import Character, Relation, ALL_CHARACTERS  # noqa: E402
from llm_client import call_json  # noqa: E402

ROOT = Path(__file__).parent.parent.parent
CHAR_DIR = ROOT / "data" / "characters"
OUT_DIR = ROOT / "data" / "relations"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = OUT_DIR / "relations.json"

RelationListAdapter = TypeAdapter(list[Relation])


SYSTEM_PROMPT = """你是希腊神话族谱与事件关系学者。任务是基于已结构化的 18 个核心人物资料，输出他们之间的关系边数组。

**5 类关系（primary_type）：**
- `blood`     血缘（父母子女、兄弟姐妹、祖孙等任何血缘）
- `marriage`  婚姻或情人（包括宙斯的私生关系）
- `hostile`   敌对、杀害、战争对立、长期仇视
- `ally`      同伴、战友、阿尔戈或特洛伊战争同方协作
- `mentor`    师徒、庇护、长期指点（如雅典娜庇护奥德修斯）

**规则：**
1. 一对人物只产出**一条边**，按"最主导"的关系定 primary_type，其余进 composite_types。
2. 例如俄狄浦斯-伊俄卡斯特（如果这对存在）= primary 婚姻 + composite 血缘。
3. 宙斯-赫拉 = primary 婚姻 + composite 血缘（兄妹）+ composite 敌对。
4. **events 必须有内容**——至少 1 条，最多 6 条。每条 `{title, desc, source?, era_order}`。
5. **source 可选**但若能溯源到《伊利亚特》《奥德赛》《神谱》《变形记》《书库》请尽量填，不要编造。
6. **era_order 从 0 起递增**——表示在他们关系中的时间序号。
7. **不要漏掉重要关系**：宙斯/赫拉/泰坦/原始神之间的血缘、特洛伊战争中的敌对、阿喀琉斯-赫克托耳、珀尔修斯-美杜莎、赫拉克勒斯-赫拉、宙斯-普罗米修斯等。
8. **id 命名**：`{source}-{target}` 全小写，按字典序排列两个 slug。例：`achilles-hector`。
9. **schema_version 固定为 1**。

**输出：严格的 JSON 数组（顶层），元素是 Relation 对象。不要 ```json 围栏。**"""


def build_char_brief(char: Character) -> dict:
    """简版人物档案，喂给关系抽取 LLM。"""
    return {
        "id": char.id,
        "name_zh": char.name_zh,
        "category": char.category.value,
        "era_layer": char.era_layer,
        "epithet": char.epithet,
        "bio": char.bio,
        "events": [{"title": e.title, "desc": e.desc[:120]} for e in char.events],
    }


def load_all_chars() -> list[Character]:
    chars = []
    for slug, *_ in ALL_CHARACTERS:
        p = CHAR_DIR / f"{slug}.json"
        if not p.exists():
            raise FileNotFoundError(f"缺少 {p}")
        chars.append(Character.model_validate_json(p.read_text(encoding="utf-8")))
    return chars


def main():
    chars = load_all_chars()
    print(f"已载入 {len(chars)} 个人物")

    briefs = [build_char_brief(c) for c in chars]
    char_index = {c.id: c.name_zh for c in chars}

    user_prompt = f"""以下是已结构化的 {len(briefs)} 个希腊神话核心人物档案（精简版）。请基于这些资料产出他们之间的**完整关系图**，按 Relation schema 输出 JSON 数组。

**目标边数：与人物数量相当或略多**（30 人约 80-130 条边，每条都要有据可查）。

**人物清单（id → name_zh）：**
{json.dumps(char_index, ensure_ascii=False, indent=2)}

---

**人物档案：**
{json.dumps(briefs, ensure_ascii=False, indent=2)}

---

请输出 JSON 数组。每个元素结构：
```
{{
  "schema_version": 1,
  "id": "achilles-hector",
  "source": "achilles",
  "target": "hector",
  "primary_type": "hostile",
  "composite_types": [],
  "events": [
    {{"title": "...", "desc": "...", "source": {{"work": "Iliad", "locus": "22.247-366"}}, "era_order": 0}}
  ]
}}
```

现在输出 JSON 数组："""

    for attempt in range(1, 4):
        try:
            print(f"\n调 LLM 抽关系（attempt {attempt}）...")
            data = call_json(SYSTEM_PROMPT, user_prompt, max_tokens=16000)
            if not isinstance(data, list):
                raise ValueError(f"期望 list，得到 {type(data).__name__}")
            relations = RelationListAdapter.validate_python(data)
            break
        except ValidationError as e:
            errs = e.errors()[:3]
            err_summary = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in errs)
            print(f"  ⚠  schema 校验失败：{err_summary}")
            if attempt < 3:
                user_prompt += f"\n\n【上次输出校验失败：{err_summary}。请严格遵守 schema 重新输出。】"
                time.sleep(2)
            else:
                raise
        except Exception as e:
            print(f"  ⚠  {type(e).__name__}: {e}")
            if attempt < 3:
                time.sleep(3)
            else:
                raise

    # 统计
    by_type: dict[str, int] = {}
    for r in relations:
        by_type[r.primary_type.value] = by_type.get(r.primary_type.value, 0) + 1

    OUT_PATH.write_text(
        json.dumps([r.model_dump(mode="json") for r in relations], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✓ 输出 {len(relations)} 条关系 → {OUT_PATH}")
    print(f"  分类统计：{by_type}")


if __name__ == "__main__":
    main()
