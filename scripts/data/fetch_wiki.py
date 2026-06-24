"""
抓取 18 人 MVP 的中英文 Wikipedia 原文 → data/raw/

直接调 MediaWiki action API：
  https://en.wikipedia.org/w/api.php?action=query&prop=extracts&...

用 requests（读 HTTP_PROXY/HTTPS_PROXY 环境变量），避免 wikipedia-api 库内部 httpx 不识别代理。

输出：
  data/raw/{slug}.en.json  — {title, url, extract, sections?}
  data/raw/{slug}.zh.json  — 同上

决策来源：docs/design-freeze.md §2 (双源 Wiki)
"""

from __future__ import annotations
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote

import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

sys.path.insert(0, str(Path(__file__).parent))
from schemas import ALL_CHARACTERS  # noqa: E402

ROOT = Path(__file__).parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

USER_AGENT = "GreekMyths/0.1 (https://github.com/odin/greek-myths; research)"
PROXY = os.getenv("WIKI_PROXY", "http://127.0.0.1:7897")
PROXIES = {"http": PROXY, "https": PROXY}

EN_TITLE_OVERRIDE: dict[str, str] = {
    "zeus":       "Zeus",
    "hera":       "Hera",
    "poseidon":   "Poseidon",
    "athena":     "Athena",
    "apollo":     "Apollo",
    "artemis":    "Artemis",
    "aphrodite":  "Aphrodite",
    "ares":       "Ares",
    "cronus":     "Cronus",
    "prometheus": "Prometheus",
    "gaia":       "Gaia",
    "medusa":     "Medusa",
    "achilles":   "Achilles",
    "odysseus":   "Odysseus",
    "hector":     "Hector",
    "heracles":   "Heracles",
    "perseus":    "Perseus",
    "helen":      "Helen of Troy",
    # Batch 30 增量
    "hermes":     "Hermes",
    "demeter":    "Demeter",
    "rhea":       "Rhea (mythology)",
    "minotaur":   "Minotaur",
    "polyphemus": "Polyphemus",
    "agamemnon":  "Agamemnon",
    "paris":      "Paris (mythology)",
    "jason":      "Jason",
    "medea":      "Medea",
    "theseus":    "Theseus",
    "penelope":   "Penelope",
    "hecate":     "Hecate",
}

ZH_TITLE_OVERRIDE: dict[str, str] = {
    "zeus":       "宙斯",
    "hera":       "赫拉",
    "poseidon":   "波塞冬",
    "athena":     "雅典娜",
    "apollo":     "阿波罗",
    "artemis":    "阿耳忒弥斯",
    "aphrodite":  "阿佛洛狄忒",
    "ares":       "阿瑞斯",
    "cronus":     "克洛诺斯",
    "prometheus": "普罗米修斯",
    "gaia":       "盖亚",
    "medusa":     "美杜莎",
    "achilles":   "阿喀琉斯",
    "odysseus":   "奧德修斯",
    "hector":     "赫克托耳",
    "heracles":   "赫拉克勒斯",
    "perseus":    "珀耳修斯",
    "helen":      "海伦",
    # Batch 30 增量
    "hermes":     "赫耳墨斯",
    "demeter":    "得墨忒尔",
    "rhea":       "瑞亚_(神话)",
    "minotaur":   "弥诺陶洛斯",
    "polyphemus": "波吕斐摩斯",
    "agamemnon":  "阿伽门农",
    "paris":      "帕里斯",
    "jason":      "伊阿宋",
    "medea":      "美狄亚",
    "theseus":    "忒修斯",
    "penelope":   "佩内洛佩",
    "hecate":     "赫卡忒",
}


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


def main():
    print(f"代理：{PROXY}")
    print(f"目标 {len(ALL_CHARACTERS)} 人 × 2 语言 = {len(ALL_CHARACTERS) * 2} 个词条")
    print(f"输出目录：{RAW_DIR}\n")

    stats = {"en_ok": 0, "en_miss": 0, "en_skip": 0, "zh_ok": 0, "zh_miss": 0, "zh_skip": 0}

    for slug, name_zh, name_en, _category, _era, _epithet in ALL_CHARACTERS:
        print(f"[{slug}] {name_zh} / {name_en}")

        en_path = RAW_DIR / f"{slug}.en.json"
        if en_path.exists():
            stats["en_skip"] += 1
            print(f"  · [en] 已抓，跳过")
        else:
            en_title = EN_TITLE_OVERRIDE.get(slug, name_en)
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

        zh_path = RAW_DIR / f"{slug}.zh.json"
        if zh_path.exists():
            stats["zh_skip"] += 1
            print(f"  · [zh] 已抓，跳过")
        else:
            zh_title = ZH_TITLE_OVERRIDE.get(slug, name_zh)
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
