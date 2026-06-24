"""
doubao-seedream-5.0-lite 健康检查

发一个最小请求验证：
  1) API key + base_url 有效
  2) 模型名 "doubao-seedream-5.0-lite" 存在
  3) 参数（size, output_format, response_format, watermark）兼容
  4) 返回的图片 URL 时效（立即下载落盘验证）

输出：tmp/healthcheck_<timestamp>.png

决策来源：docs/design-freeze.md §3.1 (健康检查必做)
"""

from __future__ import annotations
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
import requests
from volcenginesdkarkruntime import Ark

ROOT = Path(__file__).parent.parent.parent
load_dotenv(ROOT / ".env")

ARK_KEY = os.getenv("ARK_API_KEY")
if not ARK_KEY:
    print("ERROR: ARK_API_KEY 未设置")
    sys.exit(1)

# Agent Plan endpoint — SDK 会在 base_url 后自动拼 /images/generations
BASE_URL = "https://ark.cn-beijing.volces.com/api/plan/v3"

TMP_DIR = ROOT / "tmp"
TMP_DIR.mkdir(exist_ok=True)


def main():
    print("=" * 60)
    print("doubao-seedream-5.0-lite 健康检查")
    print("=" * 60)
    print(f"API key: {ARK_KEY[:18]}...")
    print(f"base_url: {BASE_URL}")
    print()

    client = Ark(base_url=BASE_URL, api_key=ARK_KEY)

    prompt = (
        "Greek mythology hero portrait, half-body, three-quarter view, "
        "dramatic chiaroscuro side-back lighting, painterly oil semi-realistic style, "
        "deep atmospheric dark background with subtle classical motifs, "
        "wearing ancient Greek chiton, no hands visible, no border, "
        "portrait of Zeus, white beard, regal expression, holding lightning aura. "
        "2:3 aspect ratio."
    )

    print("→ 发送生成请求（宙斯试水图）...")
    t0 = time.time()
    try:
        resp = client.images.generate(
            model="doubao-seedream-5.0-lite",
            prompt=prompt,
            size="2K",                  # 设计冻结文档要求 800×1200 — 后续下载后再裁剪
            output_format="png",
            response_format="url",
            watermark=False,
        )
    except Exception as e:
        print(f"✗ 生成失败：{type(e).__name__}: {e}")
        sys.exit(2)

    dt = time.time() - t0
    print(f"✓ 生成耗时 {dt:.1f}s")
    print(f"  data items: {len(resp.data)}")

    if not resp.data:
        print("✗ 返回 data 为空")
        sys.exit(3)

    url = resp.data[0].url
    print(f"  URL: {url[:80]}...")

    # 立即下载 — 验证 URL 时效
    print("\n→ 立即下载验证 URL 时效...")
    ts = int(time.time())
    out_path = TMP_DIR / f"healthcheck_{ts}.png"
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"✗ 下载失败：{e}")
        sys.exit(4)

    out_path.write_bytes(r.content)
    size_kb = len(r.content) / 1024
    print(f"✓ 下载成功：{out_path} ({size_kb:.0f} KB)")

    # 探测图像尺寸
    try:
        from PIL import Image
        img = Image.open(out_path)
        print(f"  尺寸：{img.size[0]}×{img.size[1]}, mode={img.mode}")
    except Exception as e:
        print(f"  (Pillow 探测失败：{e})")

    print()
    print("=" * 60)
    print("✓ 健康检查全部通过")
    print(f"  请打开 {out_path} 目视检查风格")
    print("=" * 60)


if __name__ == "__main__":
    main()
