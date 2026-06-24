"""
Character & Relation 数据 schema（Python 侧）

与 TypeScript 端 src/schemas/character.ts 保持一致。
字段变更必须同时改两侧 + 升 SCHEMA_VERSION。

决策来源：docs/design-freeze.md §2, §8
"""

from __future__ import annotations
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict

SCHEMA_VERSION = 1


# ─────────────────────────────────────────────────────────────
# 节点 10 类分类（决定边框色）
# ─────────────────────────────────────────────────────────────
class CharacterCategory(str, Enum):
    OLYMPIAN = "olympian"
    TITAN = "titan"
    PRIMORDIAL = "primordial"
    MONSTER = "monster"
    ACHAEAN = "achaean"
    TROJAN = "trojan"
    ARGONAUT = "argonaut"
    INDEPENDENT_HERO = "independent_hero"
    MORTAL_NONCOMBAT = "mortal_noncombat"
    MINOR_DEITY = "minor_deity"


# ─────────────────────────────────────────────────────────────
# 关系 5 类（决定边色）
# ─────────────────────────────────────────────────────────────
class RelationType(str, Enum):
    BLOOD = "blood"
    MARRIAGE = "marriage"
    HOSTILE = "hostile"
    ALLY = "ally"
    MENTOR = "mentor"


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
# 人物事件
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

    schema_version: int = Field(default=SCHEMA_VERSION)
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    name_zh: str
    name_en: str
    aliases: List[str] = Field(default_factory=list)
    epithet: Optional[str] = None
    category: CharacterCategory
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

    schema_version: int = Field(default=SCHEMA_VERSION)
    id: str
    source: str
    target: str
    primary_type: RelationType
    composite_types: List[RelationType] = Field(default_factory=list)
    events: List[RelationEvent] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# 数据集容器
# ─────────────────────────────────────────────────────────────
class Dataset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = Field(default=SCHEMA_VERSION)
    characters: List[Character]
    relations: List[Relation]


# ─────────────────────────────────────────────────────────────
# MVP 人物清单（id, 中文名, 英文名, 分类, 代际, 称号）
# 决策来源：docs/design-freeze.md §10 + 后续 batch 扩展
# ─────────────────────────────────────────────────────────────
MVP_18 = [
    # 奥林匹斯神 (8)
    ("zeus",       "宙斯",       "Zeus",       CharacterCategory.OLYMPIAN, 2, "众神之王"),
    ("hera",       "赫拉",       "Hera",       CharacterCategory.OLYMPIAN, 2, "天后"),
    ("poseidon",   "波塞冬",     "Poseidon",   CharacterCategory.OLYMPIAN, 2, "海洋之神"),
    ("athena",     "雅典娜",     "Athena",     CharacterCategory.OLYMPIAN, 2, "智慧与战争策略女神"),
    ("apollo",     "阿波罗",     "Apollo",     CharacterCategory.OLYMPIAN, 2, "光明、音乐与预言之神"),
    ("artemis",    "阿尔忒弥斯", "Artemis",    CharacterCategory.OLYMPIAN, 2, "狩猎与月亮女神"),
    ("aphrodite",  "阿芙洛狄忒", "Aphrodite",  CharacterCategory.OLYMPIAN, 2, "爱与美的女神"),
    ("ares",       "阿瑞斯",     "Ares",       CharacterCategory.OLYMPIAN, 2, "战神"),
    # 泰坦 (2)
    ("cronus",     "克洛诺斯",   "Cronus",     CharacterCategory.TITAN, 1, "时间与收割之神"),
    ("prometheus", "普罗米修斯", "Prometheus", CharacterCategory.TITAN, 1, "先知,人类的庇护者"),
    # 原始神 (1)
    ("gaia",       "盖亚",       "Gaia",       CharacterCategory.PRIMORDIAL, 0, "大地母神"),
    # 怪物 (1)
    ("medusa",     "美杜莎",     "Medusa",     CharacterCategory.MONSTER, 3, "蛇发女妖"),
    # 阿开亚联军 (2)
    ("achilles",   "阿喀琉斯",   "Achilles",   CharacterCategory.ACHAEAN, 4, "疾足的英雄"),
    ("odysseus",   "奥德修斯",   "Odysseus",   CharacterCategory.ACHAEAN, 4, "足智多谋者"),
    # 特洛伊方 (1)
    ("hector",     "赫克托耳",   "Hector",     CharacterCategory.TROJAN, 4, "特洛伊第一勇士"),
    # 独立英雄 (2)
    ("heracles",   "赫拉克勒斯", "Heracles",   CharacterCategory.INDEPENDENT_HERO, 3, "十二功业的完成者"),
    ("perseus",    "珀尔修斯",   "Perseus",    CharacterCategory.INDEPENDENT_HERO, 3, "美杜莎的斩首者"),
    # 凡人非战角色 (1)
    ("helen",      "海伦",       "Helen",      CharacterCategory.MORTAL_NONCOMBAT, 4, "斯巴达王后,特洛伊战争之因"),
]

# Batch 2: 12 人扩展 → 累计 30，覆盖全部 10 类
BATCH_30_EXTRA = [
    # 奥林匹斯神 +2
    ("hermes",     "赫尔墨斯",   "Hermes",     CharacterCategory.OLYMPIAN, 2, "众神信使,旅人与窃贼的守护神"),
    ("demeter",    "得墨忒尔",   "Demeter",    CharacterCategory.OLYMPIAN, 2, "丰收与农业女神"),
    # 泰坦 +1
    ("rhea",       "瑞亚",       "Rhea",       CharacterCategory.TITAN, 1, "众神之母,克洛诺斯之妻"),
    # 怪物 +2
    ("minotaur",   "米诺陶",     "Minotaur",   CharacterCategory.MONSTER, 4, "克里特迷宫中的牛头人"),
    ("polyphemus", "波吕斐摩斯", "Polyphemus", CharacterCategory.MONSTER, 4, "独眼巨人"),
    # 阿开亚联军 +1
    ("agamemnon",  "阿伽门农",   "Agamemnon",  CharacterCategory.ACHAEAN, 4, "希腊联军统帅"),
    # 特洛伊方 +1
    ("paris",      "帕里斯",     "Paris",      CharacterCategory.TROJAN, 4, "特洛伊王子,引发战争之人"),
    # 阿尔戈英雄 +2（开启第 7 类）
    ("jason",      "伊阿宋",     "Jason",      CharacterCategory.ARGONAUT, 3, "阿尔戈号船长,金羊毛的寻获者"),
    ("medea",      "美狄亚",     "Medea",      CharacterCategory.ARGONAUT, 3, "科尔基斯公主,女巫"),
    # 独立英雄 +1
    ("theseus",    "忒修斯",     "Theseus",    CharacterCategory.INDEPENDENT_HERO, 3, "雅典之王,迷宫斩牛者"),
    # 凡人非战角色 +1
    ("penelope",   "潘妮洛佩",   "Penelope",   CharacterCategory.MORTAL_NONCOMBAT, 4, "奥德修斯之妻,忠贞的典范"),
    # 次要神祇/宁芙 +1（开启第 10 类）
    ("hecate",     "赫卡忒",     "Hecate",     CharacterCategory.MINOR_DEITY, 2, "魔法、夜晚与十字路口女神"),
]

# 当前所有已配置人物
ALL_CHARACTERS = MVP_18 + BATCH_30_EXTRA

# Batch 怪物 +10：覆盖原始怪物家族（Typhon/Echidna 及其后代）+ 单体名怪 + 海怪 + 标志性飞马
# 全部归入 era_layer 2（与原始神/泰坦/奥林匹斯神同代际左右，多数为 Typhon × Echidna 后代）
# 决策来源：用户后续怪物扩展指示 + 经典神话谱系
BATCH_MONSTERS_10 = [
    # 原始怪物之亲（2）
    ("typhon",      "堤丰",         "Typhon",      CharacterCategory.MONSTER, 1, "诸怪之父,百头风暴巨怪"),
    ("echidna",     "厄客德娜",     "Echidna",     CharacterCategory.MONSTER, 1, "诸怪之母,半人半蛇"),
    # 堤丰与厄客德娜的后代（5）
    ("cerberus",    "刻耳柏洛斯",   "Cerberus",    CharacterCategory.MONSTER, 2, "冥府三头犬"),
    ("chimera",     "喀迈拉",       "Chimera",     CharacterCategory.MONSTER, 2, "狮羊蛇三体喷火怪"),
    ("hydra",       "九头蛇",       "Hydra",       CharacterCategory.MONSTER, 2, "勒拿沼泽九头蛇"),
    ("nemean_lion", "涅墨亚狮",     "Nemean Lion", CharacterCategory.MONSTER, 2, "刀枪不入的巨狮"),
    ("sphinx",      "斯芬克斯",     "Sphinx",      CharacterCategory.MONSTER, 2, "底比斯之谜的人面狮身"),
    # 海洋双怪（2）
    ("scylla",      "斯库拉",       "Scylla",      CharacterCategory.MONSTER, 2, "墨西拿海峡六头女妖"),
    ("charybdis",   "卡律布狄斯",   "Charybdis",   CharacterCategory.MONSTER, 2, "吞海大漩涡"),
    # 标志性飞兽（1）
    ("pegasus",     "珀伽索斯",     "Pegasus",     CharacterCategory.MONSTER, 3, "美杜莎血中诞生的飞马"),
]

ALL_CHARACTERS = ALL_CHARACTERS + BATCH_MONSTERS_10

