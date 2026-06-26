"""
批量生成半身立绘 — doubao-seedream(火山方舟)

通用执行器(项目无关):
  - prompt 文案    ← projects/<slug>/prompts.json  ({id: 中文 prompt})
  - 基础画风       ← projects/<slug>/project.config.json 的 artStyle.{character,artifact}
  - 人物/器物区分  ← projects/<slug>/sources.json  (characters[] vs artifacts[])
  - 输出           → projects/<slug>/images/{portraits,thumbs,raw}/<id>.webp|png

用法:
  uv run generate_portraits.py --project greek                 # 全部(已存在跳过)
  uv run generate_portraits.py --project greek --parallel 2    # 控制并发(注意限流)
  uv run generate_portraits.py --project greek zeus hera       # 仅指定 slug

注意:图像生成计费(火山方舟 doubao-seedream)。批量前先跑 health_check.py。
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image
import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from volcenginesdkarkruntime import Ark

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

ARK_KEY = os.getenv("ARK_API_KEY")
if not ARK_KEY:
    print("ERROR: ARK_API_KEY 未设置")
    sys.exit(1)

BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"
MODEL = "doubao-seedream-5.0-lite"

client = Ark(base_url=BASE_URL, api_key=ARK_KEY)


# ─────────────────────────────────────────────────────────────
# 项目上下文
# ─────────────────────────────────────────────────────────────
class ProjectCtx:
    def __init__(self, slug: str) -> None:
        base = ROOT / "projects" / slug
        if not base.is_dir():
            sys.exit(f"项目不存在: {base}")
        self.slug = slug
        self.prompts: dict[str, str] = json.loads((base / "prompts.json").read_text("utf-8"))
        config = json.loads((base / "project.config.json").read_text("utf-8"))
        self.style_character: str = config["artStyle"]["character"]
        self.style_artifact: str = config["artStyle"]["artifact"]
        sources = json.loads((base / "sources.json").read_text("utf-8"))
        self.artifact_ids: set[str] = {a["slug"] for a in sources.get("artifacts", [])}
        self.portraits_dir = base / "images" / "portraits"
        self.thumbs_dir = base / "images" / "thumbs"
        self.raw_dir = base / "images" / "raw"
        for d in (self.portraits_dir, self.thumbs_dir, self.raw_dir):
            d.mkdir(parents=True, exist_ok=True)

    def base_style(self, slug: str) -> str:
        return self.style_artifact if slug in self.artifact_ids else self.style_character


# 由 main() 填充,供线程池 worker 读取
CTX: ProjectCtx | None = None


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=3, min=3, max=30),
    retry=retry_if_exception_type(Exception),
)
def generate_one(slug: str, desc: str, base_style: str) -> bytes:
    """单图生成 + 下载,返回 PNG 字节。"""
    full_prompt = f"{base_style}。\n\n{desc}。"
    resp = client.images.generate(
        model=MODEL,
        prompt=full_prompt,
        size="2K",
        output_format="png",
        response_format="url",
        watermark=False,
    )
    if not resp.data:
        raise RuntimeError(f"{slug}: no data returned")
    url = resp.data[0].url
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content


def process_to_portrait_and_thumb(raw_png: bytes, slug: str, ctx: ProjectCtx) -> None:
    """大图 → portraits/{slug}.webp (800×1200) + thumbs/{slug}.webp (128×192)。"""
    (ctx.raw_dir / f"{slug}.png").write_bytes(raw_png)

    img = Image.open(BytesIO(raw_png)).convert("RGB")
    target_w, target_h = 800, 1200
    src_w, src_h = img.size
    src_ratio = src_w / src_h
    target_ratio = target_w / target_h

    if abs(src_ratio - target_ratio) > 0.02:
        if src_ratio > target_ratio:
            new_w = int(src_h * target_ratio)
            left = (src_w - new_w) // 2
            img = img.crop((left, 0, left + new_w, src_h))
        else:
            new_h = int(src_w / target_ratio)
            top = (src_h - new_h) // 4  # 偏上,保留头部
            img = img.crop((0, top, src_w, top + new_h))

    portrait = img.resize((target_w, target_h), Image.LANCZOS)
    portrait.save(ctx.portraits_dir / f"{slug}.webp", "WEBP", quality=88, method=6)

    thumb = portrait.resize((128, 192), Image.LANCZOS)
    thumb.save(ctx.thumbs_dir / f"{slug}.webp", "WEBP", quality=85, method=6)


def _generate_and_save(slug: str) -> tuple[str, str | None]:
    """Worker:返回 (slug, error_msg or None)。"""
    assert CTX is not None
    desc = CTX.prompts.get(slug)
    if desc is None:
        return slug, "无 prompt 定义"

    if (CTX.portraits_dir / f"{slug}.webp").exists():
        print(f"  {slug}: 已存在，跳过", flush=True)
        return slug, None

    print(f"  {slug}: 生成中...", flush=True)
    t0 = time.time()
    try:
        raw = generate_one(slug, desc, base_style=CTX.base_style(slug))
        process_to_portrait_and_thumb(raw, slug, CTX)
    except Exception as e:
        return slug, f"{type(e).__name__}: {e}"
    dt = time.time() - t0
    print(f"  ✓ {slug}: {dt:.1f}s, raw {len(raw)//1024}KB → portraits/{slug}.webp + thumbs/{slug}.webp", flush=True)
    return slug, None


def main(project: str, target_slugs: list[str] | None, parallel: int) -> None:
    global CTX
    CTX = ProjectCtx(project)

    if not target_slugs:
        target_slugs = list(CTX.prompts.keys())

    print(f"[{project}] 准备生成 {len(target_slugs)} 张，并行 {parallel}")
    print()

    ok = 0
    fail: list[tuple[str, str]] = []
    with ThreadPoolExecutor(max_workers=parallel) as ex:
        future_map = {ex.submit(_generate_and_save, slug): slug for slug in target_slugs}
        for fut in as_completed(future_map):
            slug, err = fut.result()
            if err:
                fail.append((slug, err))
            else:
                ok += 1

    print()
    print("=" * 60)
    print(f"完成 {ok}/{len(target_slugs)}")
    if fail:
        print("失败：")
        for slug, err in fail:
            print(f"  - {slug}: {err}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="项目 slug,如 greek(无默认)")
    ap.add_argument("--parallel", type=int, default=5)
    ap.add_argument("slugs", nargs="*", help="仅生成指定 slug;留空则全部")
    args = ap.parse_args()
    main(args.project, args.slugs, parallel=args.parallel)
