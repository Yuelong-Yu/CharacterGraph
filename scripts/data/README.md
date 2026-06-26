# 数据 Pipeline

Python 脚本:按项目抓取双源 Wikipedia → LLM 结构化提取 → 产出 JSON。

所有脚本都必须显式传 `--project <slug>`;项目内容来自 `../../projects/<slug>/`。

## 运行

```bash
uv sync
uv run validate_project.py --project greek
uv run fetch_wiki.py --project greek
uv run extract_structured.py --project greek
uv run extract_relations.py --project greek
uv run translate_quotes.py --project greek
```

## 输入

- `../../projects/<slug>/project.config.json` — 分类、关系类型、层标签与画风配置
- `../../projects/<slug>/sources.json` — 抓取名册 + Wikipedia 标题覆盖

## 输出

- `../../projects/<slug>/data/raw/{id}.{en,zh}.json` — Wiki 原文(不进 git)
- `../../projects/<slug>/data/characters/{id}.json` — 结构化人物
- `../../projects/<slug>/data/relations.json` — 关系边

## 当前项目

Greek 图谱位于 `../../projects/greek/`。
