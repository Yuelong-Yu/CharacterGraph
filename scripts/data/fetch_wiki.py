"""
抓取某项目人物名册的中英文 Wikipedia 原文 → projects/<slug>/data/raw/

直接调 MediaWiki action API:
  https://en.wikipedia.org/w/api.php?action=query&prop=extracts&...

名册与标题覆盖来自 projects/<slug>/sources.json(characters / en_title_override / zh_title_override)。
抓取机制本身项目无关 —— 换项目只换 sources.json。

输出:
  projects/<slug>/data/raw/{slug}.en.json  — {title, url, extract, ...}
  projects/<slug>/data/raw/{slug}.zh.json  — 同上

用法:
  uv run fetch_wiki.py --project greek

决策来源:docs/design-freeze.md §2 (双源 Wiki) + 多项目重构
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

sys.path.insert(0, str(Path(__file__).parent))
from project_io import add_project_arg, load_sources, raw_dir  # noqa: E402

USER_AGENT = "CharacterGraph/0.1 (research)"
PROXY = os.getenv("WIKI_PROXY", "http://127.0.0.1:7897")
PROXIES = {"http": PROXY, "https": PROXY}


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=15),
    retry=retry_if_exception_type((requests.RequestException,)),
)
def call_mediawiki(lang: str, params: dict) -> dict:
    url = f"https://{lang}.wikipedia.org/w/api.php"
    headers = {"User-Agent": USER_AGENT}
    r = requests.get(url, params=params, headers=headers, proxies=PROXIES, timeout=20)
    r.raise_for_status()
    return r.json()


def fetch_extract(slug: str, lang: str, title: str) -> dict | None:
    """
    用 MediaWiki extracts API 拿纯文本正文 + summary。
    """
    # 第一步：拿 page info + extract（纯文本，全文）
    data = call_mediawiki(lang, {
        "action": "query",
        "format": "json",
        "titles": title,
        "prop": "extracts|info",
        "explaintext": 1,
        "exsectionformat": "plain",
        "inprop": "url",
        "redirects": 1,
    })
    pages = data.get("query", {}).get("pages", {})
    if not pages:
        return None
    page = next(iter(pages.values()))
    if page.get("missing") is not None or "extract" not in page:
        return None
    return {
        "slug": slug,
        "lang": lang,
        "title": page.get("title"),
        "url": page.get("fullurl"),
        "extract": page.get("extract", ""),
        "pageid": page.get("pageid"),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    add_project_arg(ap)
    args = ap.parse_args()

    sources = load_sources(args.project)
    characters = sources["characters"]
    en_override: dict[str, str] = sources.get("en_title_override", {})
    zh_override: dict[str, str] = sources.get("zh_title_override", {})
    out_dir = raw_dir(args.project)

    print(f"代理：{PROXY}")
    print(f"目标 {len(characters)} 人 × 2 语言 = {len(characters) * 2} 个词条")
    print(f"输出目录：{out_dir}\n")

    stats = {"en_ok": 0, "en_miss": 0, "en_skip": 0, "zh_ok": 0, "zh_miss": 0, "zh_skip": 0}

    for ch in characters:
        slug, name_zh, name_en = ch["slug"], ch["name_zh"], ch["name_en"]
        print(f"[{slug}] {name_zh} / {name_en}")

        en_path = out_dir / f"{slug}.en.json"
        if en_path.exists():
            stats["en_skip"] += 1
            print(f"  · [en] 已抓，跳过")
        else:
            en_title = en_override.get(slug, name_en)
            try:
                en_data = fetch_extract(slug, "en", en_title)
            except Exception as e:
                print(f"  ✗ [en] {en_title} — error: {e}")
                en_data = None
            if en_data:
                en_path.write_text(
                    json.dumps(en_data, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                stats["en_ok"] += 1
                print(f"  ✓ [en] {en_data['title']} ({len(en_data['extract'])} chars)")
            else:
                stats["en_miss"] += 1
                print(f"  ✗ [en] {en_title} — not found")

        zh_path = out_dir / f"{slug}.zh.json"
        if zh_path.exists():
            stats["zh_skip"] += 1
            print(f"  · [zh] 已抓，跳过")
        else:
            zh_title = zh_override.get(slug, name_zh)
            try:
                zh_data = fetch_extract(slug, "zh", zh_title)
            except Exception as e:
                print(f"  ✗ [zh] {zh_title} — error: {e}")
                zh_data = None
            if zh_data:
                zh_path.write_text(
                    json.dumps(zh_data, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                stats["zh_ok"] += 1
                print(f"  ✓ [zh] {zh_data['title']} ({len(zh_data['extract'])} chars)")
            else:
                stats["zh_miss"] += 1
                print(f"  ✗ [zh] {zh_title} — not found")

        time.sleep(0.3)

    print()
    print("=" * 60)
    print(f"完成。本次新抓 英文 {stats['en_ok']}, 中文 {stats['zh_ok']}; "
          f"跳过 英 {stats['en_skip']}, 中 {stats['zh_skip']}")
    if stats["en_miss"] or stats["zh_miss"]:
        print(f"未命中：英 {stats['en_miss']}, 中 {stats['zh_miss']}")


if __name__ == "__main__":
    main()
