# 图像 Pipeline

Python 脚本:调用 doubao-seedream-5.0-lite 生成半身立绘 + 缩略图。

所有生成脚本都必须显式传 `--project <slug>`;prompt 与画风来自 `../../projects/<slug>/`。

## 运行

```bash
uv sync
uv run health_check.py                         # 先用 1 张验证 API 可用性(项目无关)
uv run generate_portraits.py --project greek   # 批量生成(已存在跳过)
uv run generate_portraits.py --project greek zeus hera --parallel 1
```

## 输入

- `../../projects/<slug>/project.config.json` — `artStyle.character` / `artStyle.artifact`
- `../../projects/<slug>/prompts.json` — `{id: prompt}`
- `../../projects/<slug>/sources.json` — 用于区分人物 / 器物画风

## 输出

- `../../projects/<slug>/images/portraits/{id}.webp` — 800×1200 半身像/器物图
- `../../projects/<slug>/images/thumbs/{id}.webp` — 128×192 缩略图
- `../../projects/<slug>/images/raw/{id}.png` — AI 原图(不进 git)

## 注意

- API key 在仓库根 `.env`（`IMAGE_API_KEY`；可选 `IMAGE_BASE_URL` / `IMAGE_MODEL` 覆盖默认值）
- 图像生成计费;批量前先跑 `health_check.py`,不要无确认重生成已有图
- 火山方舟返回的图片 URL 有过期时间,必须立即下载落盘
