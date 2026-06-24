"""
LLM 结构化提取：data/raw/*.{en,zh}.json → data/characters/{slug}.json

流程：
  1) 对每个 slug，读 en + zh 原文（en 截前 12000 字，zh 截前 3000 字）
  2) 给 LLM 一个系统提示 + JSON Schema 描述 + 原文
  3) 模型按 Character schema 输出 JSON
  4) pydantic 严格校验，失败重试 2 次
  5) 落盘 data/characters/{slug}.json

决策来源：docs/design-freeze.md §2.1 (7 字段), §5 (名言严格出处), §8 (schema)
"""

from __future__ import annotations
import json
import sys
import time
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent))
from schemas import Character, CharacterCategory, ALL_CHARACTERS  # noqa: E402
from llm_client import call_json  # noqa: E402

ROOT = Path(__file__).parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "characters"
OUT_DIR.mkdir(parents=True, exist_ok=True)

EN_MAX_CHARS = 12000
ZH_MAX_CHARS = 3000

# 与 schemas.py 对齐的 enum 列表，喂给 prompt
CATEGORY_VALUES = [c.value for c in CharacterCategory]

SYSTEM_PROMPT = """你是一位严谨的古典学研究者，专精希腊神话。你的任务是把维基百科的原文整理成结构化 JSON。

**核心原则：**
1. **不编造**——不知道的字段宁可留空数组或 null，绝不杜撰。
2. **名言 quotes 必须带文献出处**：仅收录《伊利亚特》《奥德赛》《神谱》《变形记》《书库》等古典原典中真实出现的原句。没有出处的传世名言不要写。若一个都没有，quotes 返回 `[]`。
3. **technical 字段**：
   - `skills` 是动词短语（如"投掷雷霆"、"化身天鹅"、"使人发疯"）
   - `domains` 是名词（如"雷电"、"婚姻"、"主权"），代表神职/领域
   - 二者不要重复
4. **bio 字段**：200-600 字中文连贯叙述生平，不分点。
5. **events 字段**：3-15 条该人物的重要事件。每条 title 简短（5-15 字），desc 80-200 字。
6. **aliases**：常见别名/异名（如朱庇特、雷霆神、Jove），列入数组。

**输出格式：严格的 JSON 对象，不要 ```json 围栏，不要其他文字。**"""


def build_user_prompt(slug: str, name_zh: str, name_en: str,
                      category: CharacterCategory, era_layer: int,
                      epithet: str,
                      en_text: str, zh_text: str) -> str:
    portrait = f"/images/portraits/{slug}.webp"
    thumb = f"/images/thumbs/{slug}.webp"

    return f"""请基于下列维基百科原文，按指定 JSON 结构产出 **{name_zh}（{name_en}）** 的结构化资料。

**已锁定的字段（不要更改）：**
- `schema_version`: 1
- `id`: "{slug}"
- `name_zh`: "{name_zh}"
- `name_en`: "{name_en}"
- `epithet`: "{epithet}"
- `category`: "{category.value}"
- `era_layer`: {era_layer}
- `portrait`: "{portrait}"
- `thumb`: "{thumb}"

**你需要从原文提取并填充以下字段：**
- `aliases`: 字符串数组（中文/英文/罗马名/异名）
- `bio`: 字符串（200-600 字中文生平叙述）
- `events`: 数组，每项 `{{title, desc, source?}}`。source 是 `{{work, locus?, translator?}}`。
- `quotes`: 数组，每项 `{{text, source}}`，source 必填且必须是真实古典文献。**没有就给 []**。
- `weapons`: 字符串数组
- `skills`: 字符串数组（动词短语）
- `domains`: 字符串数组（名词，神职/领域）
- `mounts`: 字符串数组（如"四匹白马拉的金车"算坐骑）

**输出 JSON 时所有字段必须齐全**（即便是空数组）。

---

【英文维基百科原文（前 {len(en_text)} 字）】
{en_text}

---

【中文维基百科原文（前 {len(zh_text)} 字，辅助译名/语境）】
{zh_text}

---

现在输出 JSON："""


def load_raw(slug: str) -> tuple[str, str]:
    en_path = RAW_DIR / f"{slug}.en.json"
    zh_path = RAW_DIR / f"{slug}.zh.json"
    en_text = ""
    zh_text = ""
    if en_path.exists():
        en_text = json.loads(en_path.read_text(encoding="utf-8")).get("extract", "")[:EN_MAX_CHARS]
    if zh_path.exists():
        zh_text = json.loads(zh_path.read_text(encoding="utf-8")).get("extract", "")[:ZH_MAX_CHARS]
    return en_text, zh_text


def extract_one(slug: str, name_zh: str, name_en: str,
                category: CharacterCategory, era_layer: int, epithet: str) -> Character | None:
    en_text, zh_text = load_raw(slug)
    if not en_text and not zh_text:
        print(f"  ✗ {slug} 无 raw 数据")
        return None

    user_prompt = build_user_prompt(
        slug, name_zh, name_en, category, era_layer, epithet, en_text, zh_text
    )

    for attempt in range(1, 4):
        try:
            data = call_json(SYSTEM_PROMPT, user_prompt, max_tokens=8192)
            char = Character.model_validate(data)
            return char
        except ValidationError as e:
            errs = e.errors()[:3]
            err_summary = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in errs)
            print(f"  ⚠  尝试 {attempt}：schema 验证失败 — {err_summary}")
            # 把错误反馈给模型再试
            user_prompt = (
                user_prompt
                + f"\n\n【上次输出 schema 校验失败：{err_summary}。请严格按字段名/类型重新输出 JSON。】"
            )
        except Exception as e:
            print(f"  ⚠  尝试 {attempt}：{type(e).__name__} — {e}")
            time.sleep(2)
    return None


def main():
    print(f"提取 {len(ALL_CHARACTERS)} 个人物 → {OUT_DIR}\n")
    ok = 0
    fail: list[str] = []

    for slug, name_zh, name_en, category, era_layer, epithet in ALL_CHARACTERS:
        out_path = OUT_DIR / f"{slug}.json"
        if out_path.exists():
            print(f"[{slug}] 已存在，跳过")
            ok += 1
            continue

        print(f"[{slug}] {name_zh} ({category.value}, layer={era_layer})")
        char = extract_one(slug, name_zh, name_en, category, era_layer, epithet)
        if char is None:
            print(f"  ✗ 失败")
            fail.append(slug)
            continue

        out_path.write_text(
            char.model_dump_json(indent=2, exclude_none=False),
            encoding="utf-8",
        )
        print(f"  ✓ {len(char.events)} events, {len(char.quotes)} quotes, "
              f"{len(char.skills)} skills, {len(char.domains)} domains, "
              f"{len(char.aliases)} aliases, bio={len(char.bio or '')}字")
        ok += 1
        time.sleep(0.5)

    print()
    print("=" * 60)
    print(f"完成 {ok}/{len(ALL_CHARACTERS)}")
    if fail:
        print(f"失败：{fail}")


if __name__ == "__main__":
    main()
