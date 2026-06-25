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

SCHEMA_VERSION = 2


# ─────────────────────────────────────────────────────────────
# 节点 10 类分类(Character,决定边框色)
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
    MINOR_DEITY = "minor_deity"


# ─────────────────────────────────────────────────────────────
# 武器/宝物 2 类(Artifact,决定边框色)
# ─────────────────────────────────────────────────────────────
class ArtifactCategory(str, Enum):
    WEAPON = "weapon"
    TREASURE = "treasure"


# ─────────────────────────────────────────────────────────────
# 关系 6 类(决定边色)
# ─────────────────────────────────────────────────────────────
class RelationType(str, Enum):
    BLOOD = "blood"
    MARRIAGE = "marriage"
    HOSTILE = "hostile"
    ALLY = "ally"
    MENTOR = "mentor"
    OWNS = "owns"


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
# Artifact — 武器/宝物
# ─────────────────────────────────────────────────────────────
class Artifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=SCHEMA_VERSION)
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    name_zh: str
    name_en: str
    aliases: List[str] = Field(default_factory=list)
    epithet: Optional[str] = None
    category: ArtifactCategory

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
    artifacts: List[Artifact] = Field(default_factory=list)
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
    # 特洛伊方关联角色 (1)
    ("helen",      "海伦",       "Helen",      CharacterCategory.TROJAN, 4, "斯巴达王后,特洛伊战争之因"),
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
    # 阿开亚联军家属 +1
    ("penelope",   "潘妮洛佩",   "Penelope",   CharacterCategory.ACHAEAN, 4, "奥德修斯之妻,忠贞的典范"),
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

# Batch 高叙事频率人物 +7：补赫淮斯托斯与底比斯/迷宫/奥德赛/特洛伊/珀尔修斯断点
BATCH_HIGH_FREQ_7 = [
    ("hephaestus", "赫淮斯托斯", "Hephaestus", CharacterCategory.OLYMPIAN, 2, "火焰、锻造与工匠之神"),
    ("oedipus",    "俄狄浦斯",   "Oedipus",    CharacterCategory.INDEPENDENT_HERO, 4, "解开斯芬克斯之谜的底比斯王"),
    ("ariadne",    "阿里阿德涅", "Ariadne",    CharacterCategory.INDEPENDENT_HERO, 3, "赠线团助忒修斯出迷宫的克里特公主"),
    ("daedalus",   "代达罗斯",   "Daedalus",   CharacterCategory.INDEPENDENT_HERO, 3, "迷宫与飞翼的神匠"),
    ("circe",      "喀耳刻",     "Circe",      CharacterCategory.MINOR_DEITY, 3, "艾尤岛女巫,变形魔法的主人"),
    ("cassandra",  "卡桑德拉",   "Cassandra",  CharacterCategory.TROJAN, 4, "无人相信的特洛伊预言者"),
    ("andromeda",  "安德洛墨达", "Andromeda",  CharacterCategory.INDEPENDENT_HERO, 3, "被珀尔修斯救下的埃塞俄比亚公主"),
]

ALL_CHARACTERS = ALL_CHARACTERS + BATCH_HIGH_FREQ_7

# Batch 大扩展 +15:补冥界、奥林匹斯主神缺位、特洛伊战争阵容、阿尔戈/独立英雄与名怪
BATCH_EXPANSION_15 = [
    # 奥林匹斯/冥界 (3)
    ("hades",          "哈迪斯",       "Hades",          CharacterCategory.OLYMPIAN, 2, "冥界之王,亡者与财富之神"),
    ("persephone",     "珀耳塞福涅",   "Persephone",     CharacterCategory.OLYMPIAN, 2, "冥后,春之女神"),
    ("dionysus",       "狄俄尼索斯",   "Dionysus",       CharacterCategory.OLYMPIAN, 3, "酒、狂欢与戏剧之神"),
    # 泰坦 (1)
    ("atlas",          "阿特拉斯",     "Atlas",          CharacterCategory.TITAN, 1, "以双肩擎天的泰坦"),
    # 次要神祇 (1)
    ("thetis",         "忒提斯",       "Thetis",         CharacterCategory.MINOR_DEITY, 2, "海中女神,阿喀琉斯之母"),
    # 阿开亚联军 (2)
    ("patroclus",      "帕特罗克洛斯", "Patroclus",      CharacterCategory.ACHAEAN, 4, "阿喀琉斯挚友"),
    ("menelaus",       "墨涅拉俄斯",   "Menelaus",       CharacterCategory.ACHAEAN, 4, "斯巴达王,海伦之夫"),
    # 特洛伊方 (2)
    ("priam",          "普里阿摩斯",   "Priam",          CharacterCategory.TROJAN, 4, "特洛伊末代国王"),
    ("aeneas",         "埃涅阿斯",     "Aeneas",         CharacterCategory.TROJAN, 4, "特洛伊幸存者,罗马先祖"),
    # 阿尔戈英雄 (1)
    ("orpheus",        "奥菲斯",       "Orpheus",        CharacterCategory.ARGONAUT, 3, "下冥府寻妻的乐圣"),
    # 独立英雄 (1)
    ("bellerophon",    "柏勒洛丰",     "Bellerophon",    CharacterCategory.INDEPENDENT_HERO, 3, "驯飞马屠喀迈拉的英雄"),
    # 怪物 (4)
    ("sirens",         "塞壬",         "Sirens",         CharacterCategory.MONSTER, 3, "以歌声诱杀水手的海妖"),
    ("argus_panoptes", "阿耳戈斯",     "Argus Panoptes", CharacterCategory.MONSTER, 2, "百眼不眠的看守巨人"),
    ("harpies",        "哈耳庇厄",     "Harpies",        CharacterCategory.MONSTER, 2, "夺食施秽的鸟身女妖"),
    ("ladon",          "拉冬",         "Ladon",          CharacterCategory.MONSTER, 2, "看守金苹果的百头巨龙"),
]

ALL_CHARACTERS = ALL_CHARACTERS + BATCH_EXPANSION_15

# Batch 大扩展 +17:补原始神/泰坦/冥界配角、英雄、名怪与著名坐骑神兽
BATCH_EXPANSION_17 = [
    # 原始神 (3)
    ("uranus",         "乌拉诺斯",     "Uranus",         CharacterCategory.PRIMORDIAL, 0, "原始天空之神,众泰坦之父"),
    ("eros",           "厄洛斯",       "Eros",           CharacterCategory.PRIMORDIAL, 0, "原始爱欲之神"),
    ("thanatos",       "塔纳托斯",     "Thanatos",       CharacterCategory.PRIMORDIAL, 0, "死亡的化身"),
    # 泰坦 (2)
    ("helios",         "赫利俄斯",     "Helios",         CharacterCategory.TITAN, 1, "驾日车巡天的太阳神"),
    ("leto",           "勒托",         "Leto",           CharacterCategory.TITAN, 1, "阿波罗与阿尔忒弥斯之母"),
    # 次要神祇 (2)
    ("charon",         "卡戎",         "Charon",         CharacterCategory.MINOR_DEITY, 1, "冥河摆渡人"),
    ("pan",            "潘",           "Pan",            CharacterCategory.MINOR_DEITY, 2, "山林、牧群与恐慌之神"),
    # 阿尔戈英雄 (2)
    ("atalanta",       "阿塔兰忒",     "Atalanta",       CharacterCategory.ARGONAUT, 3, "捷足的女猎手"),
    ("dioscuri",       "狄俄斯库里",   "Dioscuri",       CharacterCategory.ARGONAUT, 3, "卡斯托耳与波吕丢刻斯双子"),
    # 独立英雄 (1)
    ("cadmus",         "卡德摩斯",     "Cadmus",         CharacterCategory.INDEPENDENT_HERO, 3, "底比斯的创建者,播龙牙者"),
    # 怪物 (3)
    ("geryon",         "革律翁",       "Geryon",         CharacterCategory.MONSTER, 3, "三体三头的远西巨人"),
    ("talos",          "塔罗斯",       "Talos",          CharacterCategory.MONSTER, 3, "守护克里特的青铜巨人"),
    ("calydonian_boar","卡吕冬野猪",   "Calydonian Boar",CharacterCategory.MONSTER, 3, "阿尔忒弥斯所遣的巨野猪"),
    # 坐骑/神兽 (4)
    ("xanthus_balius", "克桑托斯与巴利俄斯", "Xanthus and Balius", CharacterCategory.MONSTER, 4, "阿喀琉斯能言的不死神马"),
    ("arion",          "阿里翁",       "Arion",          CharacterCategory.MONSTER, 3, "波塞冬所生的会言不死神马"),
    ("ceryneian_hind", "刻律涅亚牝鹿", "Ceryneian Hind", CharacterCategory.MONSTER, 2, "阿尔忒弥斯的金角铜蹄牝鹿"),
    ("mares_of_diomedes","狄俄墨得斯的牝马","Mares of Diomedes",CharacterCategory.MONSTER, 3, "色雷斯王的食人牝马"),
]

ALL_CHARACTERS = ALL_CHARACTERS + BATCH_EXPANSION_17


# ─────────────────────────────────────────────────────────────
# Artifact MVP 12 件(id, 中文名, 英文名, 分类, 一句话描述)
# 决策来源:用户 2026-06-24 Artifact 扩展指示
# ─────────────────────────────────────────────────────────────
ALL_ARTIFACTS = [
    # 武器(6)
    ("lightning",        "闪电",           "Thunderbolt",         ArtifactCategory.WEAPON,   "宙斯的不可抵御之武器"),
    ("trident",          "三叉戟",         "Trident",             ArtifactCategory.WEAPON,   "波塞冬撼海撼地之器"),
    ("harpe",            "镰刀剑",         "Harpe",               ArtifactCategory.WEAPON,   "克洛诺斯阉割乌拉诺斯之镰、珀尔修斯斩美杜莎之剑"),
    ("aegis",            "埃癸斯神盾",     "Aegis",               ArtifactCategory.WEAPON,   "镶嵌戈耳工首级的雅典娜/宙斯神盾"),
    ("lion_skin",        "涅墨亚狮皮",     "Nemean Lion Skin",    ArtifactCategory.WEAPON,   "赫拉克勒斯刀枪不入的战袍"),
    ("medusa_head",      "美杜莎首级",     "Head of Medusa",      ArtifactCategory.WEAPON,   "石化目光的不死兵器"),
    # 宝物(6)
    ("golden_apple",     "金苹果",         "Golden Apple",        ArtifactCategory.TREASURE, "“献给最美者”的不和之果"),
    ("golden_fleece",    "金羊毛",         "Golden Fleece",       ArtifactCategory.TREASURE, "阿尔戈英雄远征之鹄的"),
    ("helm_of_darkness", "隐身头盔",       "Helm of Darkness",    ArtifactCategory.TREASURE, "哈迪斯赐予的隐形之盔"),
    ("winged_sandals",   "金翼草鞋",       "Winged Sandals",      ArtifactCategory.TREASURE, "赫尔墨斯/珀尔修斯的飞行神鞋"),
    ("pandoras_box",     "潘多拉之盒",     "Pandora's Pithos",    ArtifactCategory.TREASURE, "封禁众苦的陶瓮"),
    ("trojan_horse",     "特洛伊木马",     "Trojan Horse",        ArtifactCategory.TREASURE, "希腊联军破城之诡计"),
    # Batch 高频器物 +4
    ("caduceus",          "双蛇杖",         "Caduceus",            ArtifactCategory.TREASURE, "赫尔墨斯的信使权杖"),
    ("bow_of_odysseus",   "奥德修斯之弓",   "Bow of Odysseus",     ArtifactCategory.WEAPON,   "伊塔卡归乡复仇的试弓"),
    ("shield_of_achilles", "阿喀琉斯之盾",  "Shield of Achilles",  ArtifactCategory.WEAPON,   "赫淮斯托斯所铸的宇宙之盾"),
    ("thread_of_ariadne", "阿里阿德涅线团", "Thread of Ariadne",   ArtifactCategory.TREASURE, "走出克里特迷宫的救命线"),
    # Batch 大扩展器物 +5
    ("lyre",              "里拉琴",         "Lyre",                ArtifactCategory.TREASURE, "赫尔墨斯所造、奥菲斯弹奏的神弦"),
    ("club_of_heracles",  "赫拉克勒斯橄榄木棒", "Club of Heracles", ArtifactCategory.WEAPON,   "赫拉克勒斯亲手削成的橄榄巨棒"),
    ("cornucopia",        "丰饶角",         "Cornucopia",          ArtifactCategory.TREASURE, "永不枯竭的丰饶之角"),
    ("spear_of_achilles", "佩利昂木梣枪",   "Pelian Spear",        ArtifactCategory.WEAPON,   "唯阿喀琉斯能挥动的梣木长枪"),
    ("bow_of_heracles",   "赫拉克勒斯之弓", "Bow of Heracles",     ArtifactCategory.WEAPON,   "淬九头蛇毒、终结特洛伊的神弓"),
    # Batch 大扩展器物 +3
    ("syrinx",              "排箫",           "Syrinx",              ArtifactCategory.TREASURE, "潘的芦笛,催眠百眼巨人之器"),
    ("necklace_of_harmonia","哈尔摩尼亚项链", "Necklace of Harmonia",ArtifactCategory.TREASURE, "赐美貌也降灾祸的诅咒项链"),
    ("ambrosia",            "神食神酒",       "Ambrosia and Nectar", ArtifactCategory.TREASURE, "诸神不死的食物与饮品"),
]

