# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of Truth

`docs/design-freeze.md` is the single source of truth for all product, data, visual, and interaction decisions. Do not improvise scope or visual rules — refer to it before changing schemas, categories, colors, layout strategy, or interaction patterns. Any change to those areas requires re-opening the design discussion, not a silent edit.

## Commands

Web (run from repo root, package manager is **pnpm**):
```bash
pnpm install
pnpm dev          # next dev
pnpm build        # next build
pnpm start        # next start
pnpm lint         # next lint
pnpm typecheck    # tsc --noEmit
```

Python pipelines (each subdir is an independent `uv` project). **All scripts require `--project <slug>` (no default).** Per-project content lives under `projects/<slug>/`:
```bash
cd scripts/data
uv sync
uv run validate_project.py --project greek   # schema + 分类/关系合法性 + 悬挂 id 校验
uv run fetch_wiki.py --project greek          # 抓双源 Wikipedia → projects/greek/data/raw/*.{en,zh}.json
uv run extract_structured.py --project greek  # LLM → projects/greek/data/characters/{slug}.json
uv run extract_relations.py --project greek   # ⚠️ 整文件重写 relations.json(覆盖全部既有边)，仅用于从零重建；增量加人勿跑,见 §Adding one character
uv run translate_quotes.py --project greek    # 名言译文回填

cd scripts/images
uv sync
uv run health_check.py                          # 单张试水，验 ARK_API_KEY + URL 时效（项目无关）
uv run generate_portraits.py --project greek    # 批量 800×1200 半身 + 128×192 缩略 → projects/greek/images/
```

`fetch_wiki.py` honors `WIKI_PROXY` (default `http://127.0.0.1:7897`) for accessing Wikipedia from CN networks. API keys (`ARK_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) live in `.env` at repo root — both pipelines read the same file via `python-dotenv`.

`pnpm dev` / `pnpm build` run `scripts/link-assets.mjs` first (predev/prebuild) to rebuild the `public/p/<slug>` → `projects/<slug>/images` symlinks (gitignored).

## Adding one character (incremental)

给现有图谱增量加**单个**人物的非破坏性流程。`fetch_wiki` / `extract_structured` / `generate_portraits` 都**跳过已存在产物**，可对整个名册重跑而只处理新条目。

1. **名册**：往 `projects/<slug>/sources.json` 的 `characters[]` 追加一项 `{slug, name_zh, name_en, category, era_layer, epithet}`（`category` 必须是 `project.config.json` 已声明的键）。
2. **抓原文**：`cd scripts/data && uv run fetch_wiki.py --project <slug>` — 只新抓该 slug 的 `data/raw/<slug>.{en,zh}.json`，其余跳过。抓完先核对 raw 是不是对的词条（防重名/重定向）。
3. **生成节点**：`uv run extract_structured.py --project <slug>` — 只对缺失的 character JSON 跑 LLM，产出 `data/characters/<slug>.json`。
4. **关系**：**手动追加**到 `data/relations.json`。⚠️ **不要跑 `extract_relations.py`** —— 它会用 LLM 重生成整张图并覆盖全部既有边。边 `id` = 两个 slug 按字典序用 `-` 连接(`source`/`target` 同序)；`primary_type` 取 `config.relationTypes` 键；每条边 ≥1 个 event，尽量带 `source` 出处。
5. **立绘 prompt**：往 `projects/<slug>/prompts.json` 加 `{"<slug>": "中文 prompt"}`。
6. **生成立绘**：`cd scripts/images && uv run generate_portraits.py --project <slug> <slug>` — 末尾位置参数限定**只生成该 slug**（计费；已存在的 webp 会跳过）。产出 `images/portraits/<slug>.webp` + `thumbs/<slug>.webp`。
7. **自测闭环**：`uv run validate_project.py --project <slug>` 必须「✓ 全部通过」（schema + 分类/关系合法性 + 悬挂 id）。可选 `pnpm dev` 浏览器目视。

## Architecture

### Multi-project (人物图谱可承载不同内容)

The app is a **single Next.js site serving many character graphs**. Each graph is a self-contained folder under `projects/<slug>/` — drop a new folder in and it appears on the homepage with zero code changes. Greek mythology is `projects/greek/`.

```
projects/<slug>/
  project.config.json   # 单一真相源(TS+Python 共读):分类/关系/层标签的色与标签 + artStyle
  prompts.json          # {id: 图像 prompt}（图像管线读）
  sources.json          # 抓取名册 + 标题覆盖（数据管线读）
  data/{characters,artifacts}/*.json, data/relations.json
  images/{portraits,thumbs,raw}/*  # raw gitignored
```

- Categories (`characterCategories` / `artifactCategories`) and `relationTypes` are **per-project, declared in `project.config.json`** — there is no global enum. `src/lib/projectConfig.tsx` injects the client subset via React Context (`useProjectConfig()`); `src/lib/tokens.ts` keeps only the project-agnostic `COLOR` / `FONT`.
- Routes: `/` is a card-wall homepage (`listProjects()` scans `projects/*`); `/[project]` is the graph (SSG via `generateStaticParams`, `notFound()` for unknown slug).
- Images are served through a gitignored symlink `public/p/<slug>` → `projects/<slug>/images`, rebuilt by `scripts/link-assets.mjs` on predev/prebuild. Node JSON `portrait`/`thumb` are explicit `/p/<slug>/...` paths.

### Data flow (static, no backend)

```
Wikipedia (双源 zh+en)
  → scripts/data/fetch_wiki.py         → projects/<slug>/data/raw/*.json   (gitignored)
  → scripts/data/extract_structured.py → projects/<slug>/data/characters/*.json
  → scripts/data/extract_relations.py  → projects/<slug>/data/relations.json
scripts/images/generate_portraits.py   → projects/<slug>/images/portraits + thumbs

src/lib/data.ts (server, fs.readdirSync)
  → loadDataset(slug): Zod parse (src/schemas/character.ts) + validate against project.config.json
  → src/app/[project]/page.tsx
  → <GraphShell dataset={...} config={...} /> (client) → ProjectConfigProvider → <Graph3D ... />
```

The site is a fully static Next.js App Router app. `loadDataset(slug)` runs only on the server at build/SSR time; the parsed `Dataset` + client config subset are serialized through props into the client `GraphShell`. The client never reads `/data/*.json` directly.

### Schema contract — two-language mirror

`src/schemas/character.ts` (Zod) and `scripts/data/schemas.py` (Pydantic) describe the same wire format. **Any field change must be made in both files and bump `SCHEMA_VERSION`** (currently `2`). `category` and `relation.primary_type` are open **slug strings** (not enums) — their legal values are declared per-project in `project.config.json` and enforced at load time (`validateAgainstConfig` in `data.ts`; `validate_against_config` in `schemas.py`). The matching TS schema for the config file is `src/schemas/projectConfig.ts`.

### Rendering

- 3D graph uses `react-force-graph-3d` + `three.js` directly. `ForceGraph3D` is wrapped via `next/dynamic({ ssr: false })` because three.js needs `window`.
- `src/components/Graph3D.tsx` (~800 lines) holds the entire 3D scene including custom node objects (image sprite + label + halo + shadow), config-keyed colors, layout modes (`tier` = era-stratified, `free` = force-directed), focus mode (selected node centered, neighbors arranged on a circle, non-neighbors hidden), search filter tiling, and the auto-tour camera animation.
- Texture/label canvases are cached in module-level `Map`s (`_texCache`, `_labelTexCache`, `_haloTex`, `_shadowTex`) — never recreate per-render.
- `src/lib/tokens.ts` only defines global colors/fonts. Per-project category/relation colors must come from `useProjectConfig()` and must be hex when used in three.js (no `oklch`).

### Components

`GraphShell.tsx` owns all UI state (selection, focus, layout mode, category filters, degree filter, search filter, auto-tour). It injects the project config via `ProjectConfigProvider`. `Graph3D.tsx` is a controlled view of that state. The old 2D React Flow components were removed; `Graph3D` is the production renderer.

### Layered visibility in focus mode

When a node is focused, edges and labels of the focused node must render above all others. This has been broken multiple times in the past — verify any z-order / render-order change in the browser before reporting done, and don't trust the layered fix without screenshotting the result.

## Project-specific conventions

- Comments and UI strings are Chinese (中文) by default. Keep that convention when editing existing files.
- `projects/*/data/raw/`, `projects/*/images/raw/`, `public/p/`, `.venv/`, `node_modules/`, `.next/` are gitignored — never commit them.
- The site is desktop-only by design. Don't add mobile-responsive layouts unless the design-freeze is updated (`design-freeze.md` §5.6 explicitly rejects mobile).
- Greek is currently an **80-character + 24-artifact** graph under `projects/greek/`. Add future graph content as a new `projects/<slug>/` folder with its own config/data/prompts/sources/images.
- Image generation is metered (Volcano Engine doubao-seedream). Don't re-run `generate_portraits.py` in bulk without confirmation — run `health_check.py` first when unsure.
- Cite-bearing fields (`quotes[].source`, `events[].source`) are mandatory for non-hallucination. If extraction produces unsourced quotes, drop them rather than fabricate a citation.

## Parent repo

This project lives under `/Users/marvin/Odin/` whose `CLAUDE.md` describes the broader **Odin** AI-native novel platform vision. CharacterGraph is an independent visualization side-project and does not share code with Odin proper — treat it as standalone.
