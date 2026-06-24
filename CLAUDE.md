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

Python pipelines (each subdir is an independent `uv` project):
```bash
cd scripts/data
uv sync
uv run fetch_wiki.py           # 抓双源 Wikipedia → data/raw/*.{en,zh}.json
uv run extract_structured.py   # LLM → data/characters/{slug}.json
uv run extract_relations.py    # LLM → data/relations/relations.json
uv run translate_quotes.py     # 名言译文回填

cd scripts/images
uv sync
uv run health_check.py         # 单张试水，验 ARK_API_KEY + URL 时效
uv run generate_portraits.py   # 批量 800×1200 半身像 + 128×128 缩略 → public/images/
```

`fetch_wiki.py` honors `WIKI_PROXY` (default `http://127.0.0.1:7897`) for accessing Wikipedia from CN networks. API keys (`ARK_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) live in `.env` at repo root — both pipelines read the same file via `python-dotenv`.

## Architecture

### Data flow (static, no backend)

```
Wikipedia (双源 zh+en)
  → scripts/data/fetch_wiki.py        → data/raw/*.json          (gitignored)
  → scripts/data/extract_structured.py → data/characters/*.json
  → scripts/data/extract_relations.py  → data/relations/relations.json
scripts/images/generate_portraits.py   → public/images/portraits + thumbs

src/lib/data.ts (Server Component, fs.readdirSync)
  → Zod parse via src/schemas/character.ts
  → loadDataset() in src/app/page.tsx
  → <GraphShell dataset={...} /> (client) → <Graph3D ... />
```

The site is a fully static Next.js App Router app. `loadDataset()` runs only on the server at build/SSR time; the parsed `Dataset` is serialized through props into the client `GraphShell`. The client never reads `/data/*.json` directly.

### Schema contract — two-language mirror

`src/schemas/character.ts` (Zod) and `scripts/data/schemas.py` (Pydantic) describe the same wire format. **Any field change must be made in both files and bump `SCHEMA_VERSION`** (currently `1`). The 10 `CharacterCategory` values and 5 `RelationType` values are closed enums — adding one means updating `CATEGORY_COLOR` / `CATEGORY_LABEL` / `RELATION_COLOR` / `RELATION_LABEL` in `src/lib/tokens.ts` as well.

### Rendering

- 3D graph uses `react-force-graph-3d` + `three.js` directly. `ForceGraph3D` is wrapped via `next/dynamic({ ssr: false })` because three.js needs `window`.
- `src/components/Graph3D.tsx` (~800 lines) holds the entire 3D scene including custom node objects (image sprite + label + halo + shadow), category-keyed colors, layout modes (`tier` = era-stratified, `free` = force-directed), focus mode (selected node centered, neighbors arranged on a circle, non-neighbors hidden), and the auto-tour camera animation.
- Texture/label canvases are cached in module-level `Map`s (`_texCache`, `_labelTexCache`, `_haloTex`, `_shadowTex`) — never recreate per-render.
- `src/lib/tokens.ts` is the only place that defines colors and fonts. White-background theme — the design-freeze depicts a darker palette but the implemented theme is light (use the actual `COLOR` / `CATEGORY_COLOR` constants, not values from `design-freeze.md` §2.2). three.js color values must be hex (no `oklch`).

### Components

`GraphShell.tsx` owns all UI state (selection, focus, layout mode, category filters, degree filter, auto-tour). `Graph3D.tsx` is a controlled view of that state. `CharacterNode.tsx` and `Graph.tsx` are legacy 2D React Flow components that are not currently mounted — `Graph3D` is the production renderer.

### Layered visibility in focus mode

When a node is focused, edges and labels of the focused node must render above all others. This has been broken multiple times in the past — verify any z-order / render-order change in the browser before reporting done, and don't trust the layered fix without screenshotting the result.

## Project-specific conventions

- Comments and UI strings are Chinese (中文) by default. Keep that convention when editing existing files.
- `data/raw/`, `public/images/raw/`, `.venv/`, `node_modules/`, `.next/` are gitignored — never commit them.
- The site is desktop-only by design. Don't add mobile-responsive layouts unless the design-freeze is updated (`design-freeze.md` §5.6 explicitly rejects mobile).
- Current scope is the **18-character MVP** (design-freeze §10–11). Don't expand to the 30 / 150 batch without explicit instruction.
- Image generation is metered (Volcano Engine doubao-seedream). Don't re-run `generate_portraits.py` in bulk without confirmation — run `health_check.py` first when unsure.
- Cite-bearing fields (`quotes[].source`, `events[].source`) are mandatory for non-hallucination. If extraction produces unsourced quotes, drop them rather than fabricate a citation.

## Parent repo

This project lives under `/Users/marvin/Odin/` whose `CLAUDE.md` describes the broader **Odin** AI-native novel platform vision. GreekMyths is an independent visualization side-project and does not share code with Odin proper — treat it as standalone.
