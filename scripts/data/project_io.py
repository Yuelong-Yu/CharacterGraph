"""项目 I/O 公共助手 —— 所有数据/图像脚本共享。

把"按 --project 解析路径 + 读 sources.json / project.config.json / prompts.json"集中一处,
让各脚本退化为通用执行器。希腊专属内容全部住在 projects/greek/。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from schemas import ProjectConfig

ROOT = Path(__file__).resolve().parents[2]


def add_project_arg(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--project", required=True, help="项目 slug,如 greek(无默认,必须显式指定)")


def project_dir(slug: str) -> Path:
    d = ROOT / "projects" / slug
    if not d.is_dir():
        raise SystemExit(f"项目不存在: {d}")
    return d


def data_dir(slug: str) -> Path:
    return project_dir(slug) / "data"


def raw_dir(slug: str) -> Path:
    d = data_dir(slug) / "raw"
    d.mkdir(parents=True, exist_ok=True)
    return d


def characters_dir(slug: str) -> Path:
    d = data_dir(slug) / "characters"
    d.mkdir(parents=True, exist_ok=True)
    return d


def artifacts_dir(slug: str) -> Path:
    d = data_dir(slug) / "artifacts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def relations_path(slug: str) -> Path:
    return data_dir(slug) / "relations.json"


def images_dir(slug: str) -> Path:
    return project_dir(slug) / "images"


def load_config(slug: str) -> ProjectConfig:
    return ProjectConfig.model_validate_json((project_dir(slug) / "project.config.json").read_text("utf-8"))


def load_sources(slug: str) -> dict[str, Any]:
    return json.loads((project_dir(slug) / "sources.json").read_text("utf-8"))


def load_prompts(slug: str) -> dict[str, str]:
    return json.loads((project_dir(slug) / "prompts.json").read_text("utf-8"))
