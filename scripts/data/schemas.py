"""
Character / Artifact / Relation 数据 schema(Python 侧)—— 项目无关通用版

与 TypeScript 端 src/schemas/character.ts 保持一致。
字段变更必须同时改两侧 + 升 SCHEMA_VERSION。

分类(category)与关系类型(primary_type)已通用化为 slug 字符串;
具体合法取值由各项目 projects/<slug>/project.config.json 定义,
在加载期通过 validate_against_config() 校验(取代原闭集 Enum)。

希腊种子名册(原 ALL_CHARACTERS / ALL_ARTIFACTS)已外移到
projects/greek/sources.json,不再硬编码于此。

决策来源:docs/design-freeze.md §2, §8 + 多项目重构
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 2

# slug 格式:小写字母开头,允许小写字母/数字/下划线
SLUG_PATTERN = r"^[a-z][a-z0-9_]*$"


# ─────────────────────────────────────────────────────────────
# 文献出处
# ─────────────────────────────────────────────────────────────
class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    work: str
    locus: Optional[str] = None
    translator: Optional[str] = None


# ─────────────────────────────────────────────────────────────
# 名言（必带文献出处，杜绝幻觉）
# ─────────────────────────────────────────────────────────────
class Quote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    source: Citation


# ─────────────────────────────────────────────────────────────
# 人物/器物事件
# ─────────────────────────────────────────────────────────────
class CharacterEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    desc: str
    source: Optional[Citation] = None


# ─────────────────────────────────────────────────────────────
# Character
# ─────────────────────────────────────────────────────────────
class Character(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=SCHEMA_VERSION, ge=1, le=2)
    id: str = Field(pattern=SLUG_PATTERN)
    name_zh: str
    name_en: str
    aliases: List[str] = Field(default_factory=list)
    epithet: Optional[str] = None
    # 具体取值见项目 config.characterCategories
    category: str = Field(pattern=SLUG_PATTERN)
    era_layer: int = Field(ge=0, le=5)

    bio: Optional[str] = None
    events: List[CharacterEvent] = Field(default_factory=list)
    quotes: List[Quote] = Field(default_factory=list)
    weapons: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    domains: List[str] = Field(default_factory=list)
    mounts: List[str] = Field(default_factory=list)

    portrait: str
    thumb: str


# ─────────────────────────────────────────────────────────────
# Artifact — 武器/宝物
# ─────────────────────────────────────────────────────────────
class Artifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=SCHEMA_VERSION, ge=1, le=2)
    id: str = Field(pattern=SLUG_PATTERN)
    name_zh: str
    name_en: str
    aliases: List[str] = Field(default_factory=list)
    epithet: Optional[str] = None
    # 具体取值见项目 config.artifactCategories
    category: str = Field(pattern=SLUG_PATTERN)

    bio: Optional[str] = None
    events: List[CharacterEvent] = Field(default_factory=list)
    domains: List[str] = Field(default_factory=list)

    portrait: str
    thumb: str


# ─────────────────────────────────────────────────────────────
# 关系事件 / Relation
# ─────────────────────────────────────────────────────────────
class RelationEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    desc: str
    desc_long: Optional[str] = None
    source: Optional[Citation] = None
    era_order: int = Field(ge=0)


class Relation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=SCHEMA_VERSION, ge=1, le=2)
    id: str
    source: str
    target: str
    # 具体取值见项目 config.relationTypes
    primary_type: str = Field(pattern=SLUG_PATTERN)
    composite_types: List[str] = Field(default_factory=list)
    events: List[RelationEvent] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# 数据集容器
# ─────────────────────────────────────────────────────────────
class Dataset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = Field(default=SCHEMA_VERSION, ge=1, le=2)
    characters: List[Character]
    artifacts: List[Artifact] = Field(default_factory=list)
    relations: List[Relation]


# ─────────────────────────────────────────────────────────────
# ProjectConfig — projects/<slug>/project.config.json(与 TS 端 projectConfig.ts 对齐)
# ─────────────────────────────────────────────────────────────
class Swatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    color: str


class ArtStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    character: str
    artifact: str


class ProjectConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=SCHEMA_VERSION, ge=1, le=2)
    slug: str = Field(pattern=SLUG_PATTERN)
    title: str
    subtitle: Optional[str] = None
    order: int = 999
    draft: bool = False
    characterCategories: Dict[str, Swatch]
    artifactCategories: Dict[str, Swatch] = Field(default_factory=dict)
    relationTypes: Dict[str, Swatch]
    eraLayers: Dict[str, str] = Field(default_factory=dict)
    artStyle: ArtStyle


# ─────────────────────────────────────────────────────────────
# 加载期校验 —— 取代原闭集 Enum 的防错能力
# ─────────────────────────────────────────────────────────────
def validate_against_config(dataset: Dataset, config: ProjectConfig) -> List[str]:
    """校验数据集中每个 category / primary_type 都已在项目 config 中声明。
    返回错误信息列表(空列表 = 通过)。"""
    errors: List[str] = []
    char_cats = set(config.characterCategories)
    art_cats = set(config.artifactCategories)
    rel_types = set(config.relationTypes)

    for c in dataset.characters:
        if c.category not in char_cats:
            errors.append(f"character[{c.id}] 未声明的分类: {c.category}")
    for a in dataset.artifacts:
        if a.category not in art_cats:
            errors.append(f"artifact[{a.id}] 未声明的分类: {a.category}")
    for r in dataset.relations:
        if r.primary_type not in rel_types:
            errors.append(f"relation[{r.id}] 未声明的关系类型: {r.primary_type}")
        for ct in r.composite_types:
            if ct not in rel_types:
                errors.append(f"relation[{r.id}] 未声明的复合关系类型: {ct}")
    return errors
