# 数据 Pipeline

Python 脚本：抓取双源 Wikipedia → LLM 结构化提取 → 产出 JSON。

## 运行

```bash
uv sync
uv run fetch_wiki.py
uv run extract_structured.py
uv run extract_relations.py
```

## 输出

- `../../data/raw/{slug}.zh.html` — 中文 Wiki 原文（不进 git）
- `../../data/raw/{slug}.en.html` — 英文 Wiki 原文（不进 git）
- `../../data/characters/{slug}.json` — 结构化人物
- `../../data/relations/relations.json` — 关系边

## 18 人清单

见仓库根 `docs/design-freeze.md` §10。
