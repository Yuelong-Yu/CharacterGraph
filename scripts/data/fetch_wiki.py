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
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from scrapling.fetchers import Fetcher
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

sys.path.insert(0, str(Path(__file__).parent))
from project_io import add_project_arg, load_config, load_sources, raw_dir  # noqa: E402

USER_AGENT = "CharacterGraph/0.1 (research)"
PROXY = os.getenv("WIKI_PROXY", "http://127.0.0.1:7897")
PROXIES = {"http": PROXY, "https": PROXY}

# 百度百科:走 Scrapling Fetcher(httpx + stealthy_headers)反反爬,作为中文维基缺失时的回退源
# Scrapling 自带浏览器指纹伪装与自适应 header,规避 requests 直连触发的 403/429 限流
BAIKE_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
_baike_session = requests.Session()
_baike_session.trust_env = False  # 关键:不继承环境/系统代理,直连百度百科


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
        "source": "wikipedia",
    }


def _clean_baike_text(text: str) -> str:
    """清洗百度百科正文:去掉 [1]/[2-3]/[1 ] 等参考角标与多余空白。"""
    text = re.sub(r"\[\s*\d+(?:[-–]\d+)?\s*\]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


@retry(
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=3, min=3, max=30),
    retry=retry_if_exception_type((requests.RequestException,)),
)
def fetch_baike(slug: str, title: str) -> dict | None:
    """抓百度百科词条概述(lemma-summary)作为中文源。

    走 Scrapling Fetcher(httpx + stealthy_headers + 浏览器指纹伪装)反反爬,
    规避 requests 直连触发的 403/429 限流。403/429/503 仍视为可重试。
    """
    url = "https://baike.baidu.com/item/" + requests.utils.quote(title)
    try:
        page = Fetcher.get(
            url,
            stealthy_headers=True,
            timeout=20,
            follow_redirects=True,
        )
    except Exception as e:
        # Scrapling 抛各种异常(RequestException 等),交给 tenacity 重试
        raise requests.RequestException(f"scrapling fetch failed for {title}: {e}")
    if page.status in (403, 429, 503):
        time.sleep(2.0)
        raise requests.HTTPError(f"baike {page.status} (反爬限流) for {title}")
    if page.status != 200:
        return None
    # lemma-summary 选择器:新版 baike 用混淆类名 lemmaSummary_XXX J-summary
    summ_matches = page.css(
        "div.lemma-summary, div[class*=lemmaSummary], div[class*=lemma-summary]"
    )
    extract = _clean_baike_text(summ_matches[0].get_all_text(strip=True)) if summ_matches else ""
    if not extract:
        metas = page.css("meta[name=description]")
        if metas:
            content = metas[0].attrib.get("content", "")
            extract = _clean_baike_text(content) if content else ""
    # 检测 baike 验证码/空壳页:被反爬重定向到 captchaview 时,meta description 是
    # "百度百科是一部内容开放、自由的网络百科全书..." 这种通用首页文本,不是真实词条
    if not extract or "百度百科是一部内容开放" in extract or len(extract) < 100:
        return None
    return {
        "slug": slug,
        "lang": "zh",
        "title": title,
        "url": url,
        "extract": extract,
        "source": "baike",
    }


def fetch_zh(slug: str, title: str, zh_source: str) -> dict | None:
    """按项目优先级抓中文源:baike 与 wikipedia 互为 fallback。
    任一源抛异常(如百科 403 反爬)或无结果,都自动切换到另一源。"""
    def _safe(fn):
        try:
            return fn()
        except Exception as e:
            print(f"    · zh 源失败({type(e).__name__}),尝试回退")
            return None

    attempts = [
        lambda: fetch_baike(slug, title),
        lambda: fetch_extract(slug, "zh", title),
    ]
    if zh_source != "baike":
        attempts.reverse()
    for fn in attempts:
        r = _safe(fn)
        if r:
            return r
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    add_project_arg(ap)
    args = ap.parse_args()

    sources = load_sources(args.project)
    config = load_config(args.project)
    zh_source = config.zhSource
    # 人物 + 器物一并抓取(器物多无独立维基,依赖百度百科回退)
    characters = sources["characters"] + sources.get("artifacts", [])
    en_override: dict[str, str] = sources.get("en_title_override", {})
    zh_override: dict[str, str] = sources.get("zh_title_override", {})
    out_dir = raw_dir(args.project)

    print(f"代理(wiki)：{PROXY}　|　中文源优先：{zh_source}")
    print(f"目标 {len(characters)} 条目(人物+器物) × 中英双源")
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
                zh_data = fetch_zh(slug, zh_title, zh_source)
            except Exception as e:
                print(f"  ✗ [zh] {zh_title} — error: {e}")
                zh_data = None
            if zh_data:
                zh_path.write_text(
                    json.dumps(zh_data, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                stats["zh_ok"] += 1
                print(f"  ✓ [zh] {zh_data['title']} ({len(zh_data['extract'])} chars) [{zh_data.get('source')}]")
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
