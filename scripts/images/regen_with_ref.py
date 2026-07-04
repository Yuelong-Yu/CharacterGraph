"""以参考图为基础,按修改要求重新生成某人物的立绘。

用法:
  uv run regen_with_ref.py --project shuihu --slug song_jiang \\
    --ref projects/shuihu/images/raw/song_jiang_bak.png \\
    --instruction "墙上题诗改为'他时若遂凌云志，敢笑黄巢不丈夫！',去除暗纹猛兽虚影烘托气场"

  uv run regen_with_ref.py --project shuihu --slug wu_song \\
    --ref projects/shuihu/images/raw/wu_song_bak.png \\
    --instruction "仅去除暗纹猛兽虚影烘托气场"

参考图通过 doubao-seedream 的 image 参数(data URL)传入,prompt 在原 prompts.json
描述基础上追加【参考图说明】+ 用户指令。会覆盖 raw/portrait/thumb 三份产物。
"""
from __future__ import annotations
import argparse
import base64
import json
import os
import sys
from io import BytesIO
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image
from volcenginesdkarkruntime import Ark

ROOT = Path(__file__).parent.parent.parent
load_dotenv(ROOT / ".env")

IMAGE_API_KEY = os.getenv("IMAGE_API_KEY")
BASE_URL = os.getenv("IMAGE_BASE_URL", "https://ark.cn-beijing.volces.com/api/plan/v3")
MODEL = os.getenv("IMAGE_MODEL", "doubao-seedream-5.0-lite")

if not IMAGE_API_KEY:
    sys.exit("IMAGE_API_KEY 未设置(检查仓库根 .env)")


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="以参考图为基础,按修改要求重新生成人物立绘",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--project", required=True, help="项目 slug,如 shuihu")
    ap.add_argument("--slug", required=True, help="人物 slug,如 song_jiang")
    ap.add_argument(
        "--ref",
        required=True,
        help="参考图路径(绝对或相对仓库根)。如 projects/shuihu/images/raw/song_jiang_bak.png",
    )
    ap.add_argument(
        "--instruction",
        required=True,
        help="修改要求(自然语言)。如 \"仅去除暗纹猛兽虚影烘托气场\"",
    )
    ap.add_argument(
        "--no-base-style",
        action="store_true",
        help="不拼接 artStyle.character 基础画风,只用 prompts.json 的 desc",
    )
    return ap.parse_args()


def resolve_ref_path(ref: str) -> Path:
    p = Path(ref).expanduser()
    if not p.is_absolute():
        p = (ROOT / ref).resolve()
    if not p.exists():
        sys.exit(f"参考图不存在: {p}")
    return p


def load_project_ctx(project: str, slug: str) -> tuple[str, str, Path, Path, Path]:
    proj = ROOT / "projects" / project
    if not proj.is_dir():
        sys.exit(f"项目不存在: {proj}")
    prompts = json.loads((proj / "prompts.json").read_text("utf-8"))
    if slug not in prompts:
        sys.exit(f"slug '{slug}' 不在 prompts.json 中")
    desc = prompts[slug]
    config = json.loads((proj / "project.config.json").read_text("utf-8"))
    sources = json.loads((proj / "sources.json").read_text("utf-8"))
    artifact_ids = {a["slug"] for a in sources.get("artifacts", [])}
    base_style = (
        config["artStyle"]["artifact"]
        if slug in artifact_ids
        else config["artStyle"]["character"]
    )
    raw_dir = proj / "images" / "raw"
    portraits_dir = proj / "images" / "portraits"
    thumbs_dir = proj / "images" / "thumbs"
    for d in (raw_dir, portraits_dir, thumbs_dir):
        d.mkdir(parents=True, exist_ok=True)
    return desc, base_style, raw_dir, portraits_dir, thumbs_dir


def build_prompt(desc: str, base_style: str, instruction: str, no_base_style: bool) -> str:
    parts = []
    if not no_base_style:
        parts.append(f"{base_style}。")
    parts.append(f"\n\n{desc}。")
    parts.append(
        f"\n\n【参考图说明】以提供的参考图为基础,保持人物形象、构图、画风一致,"
        f"仅做以下修改:{instruction}。其余保持参考图。"
    )
    return "".join(parts)


def generate(slug: str, prompt: str, ref_path: Path) -> bytes:
    ref_b64 = base64.b64encode(ref_path.read_bytes()).decode("utf-8")
    ref_image = f"data:image/png;base64,{ref_b64}"
    client = Ark(base_url=BASE_URL, api_key=IMAGE_API_KEY)
    print(f"参考图: {ref_path.name} ({len(ref_b64)//1024}KB base64)")
    print(f"模型: {MODEL}")
    print("生成中...")
    resp = client.images.generate(
        model=MODEL,
        prompt=prompt,
        image=ref_image,
        size="2K",
        output_format="png",
        response_format="url",
        watermark=False,
    )
    if not resp.data:
        sys.exit("无数据返回")
    url = resp.data[0].url
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content


def save_outputs(raw_bytes: bytes, slug: str, raw_dir: Path, portraits_dir: Path, thumbs_dir: Path) -> None:
    raw_path = raw_dir / f"{slug}.png"
    raw_path.write_bytes(raw_bytes)
    print(f"✓ raw: {raw_path} ({len(raw_bytes)//1024}KB)")

    img = Image.open(BytesIO(raw_bytes)).convert("RGB")
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
            top = (src_h - new_h) // 4
            img = img.crop((0, top, src_w, top + new_h))
    portrait = img.resize((target_w, target_h), Image.LANCZOS)
    portrait_path = portraits_dir / f"{slug}.webp"
    portrait.save(portrait_path, "WEBP", quality=88, method=6)
    print(f"✓ portrait: {portrait_path}")

    thumb = portrait.resize((128, 192), Image.LANCZOS)
    thumb_path = thumbs_dir / f"{slug}.webp"
    thumb.save(thumb_path, "WEBP", quality=85, method=6)
    print(f"✓ thumb: {thumb_path}")


def main() -> None:
    args = parse_args()
    ref_path = resolve_ref_path(args.ref)
    desc, base_style, raw_dir, portraits_dir, thumbs_dir = load_project_ctx(args.project, args.slug)
    prompt = build_prompt(desc, base_style, args.instruction, args.no_base_style)
    print(f"prompt:\n{prompt}\n")
    raw_bytes = generate(args.slug, prompt, ref_path)
    save_outputs(raw_bytes, args.slug, raw_dir, portraits_dir, thumbs_dir)
    print("\n完成。")


if __name__ == "__main__":
    main()
