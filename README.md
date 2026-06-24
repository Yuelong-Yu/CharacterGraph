# GreekMyths

希腊神话人物关系图谱网站（桌面专属、中文界面）。

详情见 [docs/design-freeze.md](docs/design-freeze.md) — 该文档是项目唯一事实来源。

## 快速开始

### 前端

```bash
pnpm install
pnpm dev          # 启动 Next.js 开发服务器
```

### 数据 Pipeline (Python)

```bash
cd scripts/data
uv sync           # 安装依赖
uv run fetch_wiki.py
uv run extract_structured.py
uv run extract_relations.py
```

### 图像 Pipeline (Python)

```bash
cd scripts/images
uv sync
uv run generate_portraits.py
```

## 环境变量

复制 `.env.example` 为 `.env` 并填入：

- `ARK_API_KEY` — 火山方舟 doubao-seedream API key
- `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` — LLM 结构化提取

## 项目状态

当前阶段：**Step 1/11 - 初始化仓库结构**

下一阶段：18 人 MVP（完成后停下验收）
