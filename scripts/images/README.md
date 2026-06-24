# 图像 Pipeline

Python 脚本：调用 doubao-seedream-5.0-lite 生成半身立绘 + 头部缩略。

## 运行

```bash
uv sync
uv run health_check.py             # 先用 1 张验证 API 可用性
uv run generate_portraits.py       # 批量生成 18 张
```

## 输出

- `../../public/images/portraits/{slug}.webp` — 800×1200 半身像
- `../../public/images/thumbs/{slug}.webp` — 128×128 头部缩略（自动裁剪）

## 风格族（5 类）

详见 `docs/design-freeze.md` §3.1。

## 注意

- API key 在仓库根 `.env`（`ARK_API_KEY`）
- 火山方舟返回的图片 URL 有过期时间，必须立即下载落盘
