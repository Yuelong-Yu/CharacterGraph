"""
LLM 结构化提取:projects/<slug>/data/raw/*.{en,zh}.json → projects/<slug>/data/characters/{slug}.json

流程:
  1) 对每个 slug,读 en + zh 原文(en 截前 12000 字,zh 截前 3000 字)
  2) 给 LLM 系统提示 + 分类法(来自 project.config.json)+ 原文
  3) 模型按 Character schema 输出 JSON
  4) pydantic 严格校验,失败重试 2 次
  5) 落盘 projects/<slug>/data/characters/{slug}.json

题材名取 config.title,分类法取 config.characterCategories,名册取 sources.json —— 脚本本身项目无关。

用法:
  uv run extract_structured.py --project greek

决策来源:docs/design-freeze.md §2.1, §5 (名言严格出处), §8 (schema) + 多项目重构
"""

from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).parent))
from schemas import Artifact, Character  # noqa: E402
from project_io import add_project_arg, artifacts_dir, characters_dir, load_config, load_sources, raw_dir  # noqa: E402
from llm_client import call_json  # noqa: E402

EN_MAX_CHARS = 12000
ZH_MAX_CHARS = 3000


def build_system_prompt(domain: str) -> str:
    return f"""你是一位严谨的研究者,专精「{domain}」。你的任务是把维基百科的原文整理成结构化 JSON。

**核心原则:**
1. **不编造**——不知道的字段宁可留空数组或 null,绝不杜撰。
2. **名言 quotes 必须带文献出处**:仅收录该题材公认原典中真实出现的原句,并标注出处。没有出处的传世名言不要写。若一个都没有,quotes 返回 `[]`。
3. **technical 字段**:
   - `skills` 是动词短语(如"投掷雷霆"、"化身天鹅")
   - `domains` 是名词(如"雷电"、"婚姻"、"主权"),代表职能/领域
   - 二者不要重复
4. **bio 字段**:200-600 字中文连贯叙述生平,不分点。
5. **events 字段**:3-15 条该人物的重要事件。每条 title 简短(5-15 字),desc 80-200 字。
6. **aliases**:常见别名/异名,列入数组。
7. **引用粒度(防杜撰)**:source.work 给可考的典籍名;locus(回目/卷次/行号)**仅在确信时填,存疑则省略 locus,绝不编造章节号**。
8. **正典标注 canon(仅多正典题材)**:若本题材存在多个并行正典版本(例如同时有"小说/演义"与"正史/史书"两套叙事),为每条 event 与 quote 标注 `canon`:`romance`(仅小说/演义有)、`history`(正史可考)、`both`(两者皆载);并据此选择 source.work(演义事件引小说,正史事件引史书)。**若本题材只有单一正典(如神话传说),则完全省略 canon 字段**。

**输出格式:严格的 JSON 对象,不要 ```json 围栏,不要其他文字。**"""


def build_user_prompt(slug: str, name_zh: str, name_en: str,
                      category: str, era_layer: int, epithet: str,
                      categories_hint: str,
                      project_slug: str,
                      en_text: str, zh_text: str) -> str:
    portrait = f"/p/{project_slug}/portraits/{slug}.webp"
    thumb = f"/p/{project_slug}/thumbs/{slug}.webp"

    return f"""请基于下列维基百科原文,按指定 JSON 结构产出 **{name_zh}（{name_en}）** 的结构化资料。

可选分类(category 必须是其一):{categories_hint}

**已锁定的字段（不要更改）:**
- `schema_version`: 3
- `id`: "{slug}"
- `name_zh`: "{name_zh}"
- `name_en`: "{name_en}"
- `epithet`: "{epithet}"
- `category`: "{category}"
- `era_layer`: {era_layer}
- `portrait`: "{portrait}"
- `thumb`: "{thumb}"

**你需要从原文提取并填充以下字段:**
- `aliases`: 字符串数组（中文/英文/罗马名/异名）
- `bio`: 字符串（200-600 字中文生平叙述）
- `events`: 数组,每项 `{{title, desc, source?, canon?}}`。source 是 `{{work, locus?, translator?}}`;canon 仅多正典题材填(见系统提示第 8 条)。
- `quotes`: 数组,每项 `{{text, source, canon?}}`,source 必填且必须是真实文献。**没有就给 []**。
- `weapons`: 字符串数组
- `skills`: 字符串数组（动词短语）
- `domains`: 字符串数组（名词,职能/领域）
- `mounts`: 字符串数组

**输出 JSON 时所有字段必须齐全**（即便是空数组）。

---

【英文维基百科原文（前 {len(en_text)} 字）】
{en_text}

---

【中文维基百科原文（前 {len(zh_text)} 字,辅助译名/语境）】
{zh_text}

---

现在输出 JSON:"""


def load_raw(raw: Path, slug: str) -> tuple[str, str]:
    en_path = raw / f"{slug}.en.json"
    zh_path = raw / f"{slug}.zh.json"
    en_text = ""
    zh_text = ""
    if en_path.exists():
        en_text = json.loads(en_path.read_text(encoding="utf-8")).get("extract", "")[:EN_MAX_CHARS]
    if zh_path.exists():
        zh_text = json.loads(zh_path.read_text(encoding="utf-8")).get("extract", "")[:ZH_MAX_CHARS]
    return en_text, zh_text


def extract_one(raw: Path, system_prompt: str, categories_hint: str, project_slug: str,
                slug: str, name_zh: str, name_en: str,
                category: str, era_layer: int, epithet: str) -> Character | None:
    en_text, zh_text = load_raw(raw, slug)
    if not en_text and not zh_text:
        print(f"  ✗ {slug} 无 raw 数据")
        return None

    user_prompt = build_user_prompt(
        slug, name_zh, name_en, category, era_layer, epithet, categories_hint, project_slug, en_text, zh_text
    )

    for attempt in range(1, 4):
        try:
            data = call_json(system_prompt, user_prompt, max_tokens=8192)
            return Character.model_validate(data)
        except ValidationError as e:
            errs = e.errors()[:3]
            err_summary = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in errs)
            print(f"  ⚠  尝试 {attempt}：schema 验证失败 — {err_summary}")
            user_prompt = (
                user_prompt
                + f"\n\n【上次输出 schema 校验失败:{err_summary}。请严格按字段名/类型重新输出 JSON。】"
            )
        except Exception as e:
            print(f"  ⚠  尝试 {attempt}：{type(e).__name__} — {e}")
            time.sleep(2)
    return None


def build_artifact_user_prompt(slug: str, name_zh: str, name_en: str,
                               category: str, epithet: str,
                               categories_hint: str, project_slug: str,
                               en_text: str, zh_text: str) -> str:
    portrait = f"/p/{project_slug}/portraits/{slug}.webp"
    thumb = f"/p/{project_slug}/thumbs/{slug}.webp"
    return f"""请基于下列原文,按指定 JSON 结构产出 **器物「{name_zh}（{name_en}）」** 的结构化资料。

可选分类(category 必须是其一):{categories_hint}

**已锁定的字段（不要更改）:**
- `schema_version`: 3
- `id`: "{slug}"
- `name_zh`: "{name_zh}"
- `name_en`: "{name_en}"
- `epithet`: "{epithet}"
- `category`: "{category}"
- `portrait`: "{portrait}"
- `thumb`: "{thumb}"

**你需要提取并填充以下字段(器物无 quotes/skills/weapons/mounts/era_layer):**
- `aliases`: 字符串数组（别名/异名）
- `bio`: 字符串（150-500 字中文:由来/形态/特性/流转/持有者）
- `events`: 数组,每项 `{{title, desc, source?, canon?}}`。source 是 `{{work, locus?, translator?}}`;canon 仅多正典题材填(见系统提示第 8 条)。
- `domains`: 字符串数组（象征/职能名词,如"武勇""主权""速度"）

**输出 JSON 时所有字段必须齐全**（即便是空数组）。

---

【英文原文（前 {len(en_text)} 字）】
{en_text}

---

【中文原文（前 {len(zh_text)} 字）】
{zh_text}

---

现在输出 JSON:"""


def extract_artifact_one(raw: Path, system_prompt: str, categories_hint: str, project_slug: str,
                         slug: str, name_zh: str, name_en: str,
                         category: str, epithet: str) -> Artifact | None:
    en_text, zh_text = load_raw(raw, slug)
    if not en_text and not zh_text:
        print(f"  ✗ {slug} 无 raw 数据")
        return None
    user_prompt = build_artifact_user_prompt(
        slug, name_zh, name_en, category, epithet, categories_hint, project_slug, en_text, zh_text
    )
    for attempt in range(1, 4):
        try:
            data = call_json(system_prompt, user_prompt, max_tokens=4096)
            return Artifact.model_validate(data)
        except ValidationError as e:
            errs = e.errors()[:3]
            err_summary = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in errs)
            print(f"  ⚠  尝试 {attempt}：schema 验证失败 — {err_summary}")
            user_prompt = user_prompt + f"\n\n【上次校验失败:{err_summary}。请严格按字段重新输出。】"
        except Exception as e:
            print(f"  ⚠  尝试 {attempt}：{type(e).__name__} — {e}")
            time.sleep(2)
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    add_project_arg(ap)
    args = ap.parse_args()

    config = load_config(args.project)
    sources = load_sources(args.project)
    characters = sources["characters"]
    out_dir = characters_dir(args.project)
    raw = raw_dir(args.project)

    system_prompt = build_system_prompt(config.title)
    categories_hint = ", ".join(f"{k}（{v.label}）" for k, v in config.characterCategories.items())

    print(f"提取 {len(characters)} 个人物 → {out_dir}\n")
    ok = 0
    fail: list[str] = []

    for ch in characters:
        slug = ch["slug"]
        out_path = out_dir / f"{slug}.json"
        if out_path.exists():
            print(f"[{slug}] 已存在，跳过")
            ok += 1
            continue

        print(f"[{slug}] {ch['name_zh']} ({ch['category']}, layer={ch['era_layer']})")
        char = extract_one(
            raw, system_prompt, categories_hint, args.project,
            slug, ch["name_zh"], ch["name_en"], ch["category"], ch["era_layer"], ch["epithet"],
        )
        if char is None:
            print(f"  ✗ 失败")
            fail.append(slug)
            continue

        out_path.write_text(char.model_dump_json(indent=2, exclude_none=False), encoding="utf-8")
        print(f"  ✓ {len(char.events)} events, {len(char.quotes)} quotes, "
              f"{len(char.skills)} skills, {len(char.domains)} domains, "
              f"{len(char.aliases)} aliases, bio={len(char.bio or '')}字")
        ok += 1
        time.sleep(0.5)

    print()
    print("=" * 60)
    print(f"完成 {ok}/{len(characters)}")
    if fail:
        print(f"失败：{fail}")

    # ── 器物抽取(Artifact schema:无 quotes/skills/weapons/mounts/era_layer) ──
    artifacts = sources.get("artifacts", [])
    if artifacts:
        art_dir = artifacts_dir(args.project)
        art_hint = ", ".join(f"{k}（{v.label}）" for k, v in config.artifactCategories.items())
        print(f"\n提取 {len(artifacts)} 个器物 → {art_dir}\n")
        a_ok = 0
        a_fail: list[str] = []
        for art in artifacts:
            slug = art["slug"]
            out_path = art_dir / f"{slug}.json"
            if out_path.exists():
                print(f"[{slug}] 已存在，跳过")
                a_ok += 1
                continue
            print(f"[{slug}] {art['name_zh']} ({art['category']})")
            obj = extract_artifact_one(
                raw, system_prompt, art_hint, args.project,
                slug, art["name_zh"], art["name_en"], art["category"], art["epithet"],
            )
            if obj is None:
                print(f"  ✗ 失败")
                a_fail.append(slug)
                continue
            out_path.write_text(obj.model_dump_json(indent=2, exclude_none=False), encoding="utf-8")
            print(f"  ✓ {len(obj.events)} events, {len(obj.domains)} domains, "
                  f"{len(obj.aliases)} aliases, bio={len(obj.bio or '')}字")
            a_ok += 1
            time.sleep(0.5)
        print()
        print("=" * 60)
        print(f"器物完成 {a_ok}/{len(artifacts)}")
        if a_fail:
            print(f"器物失败：{a_fail}")


if __name__ == "__main__":
    main()
