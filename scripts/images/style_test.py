"""
画风试水(闸门②):对少数人物各出多种**不同风格**的原图,供挑选风格方向。
不经 portrait/thumb 裁切管线,原图直存 projects/<slug>/images/_style_test/<slug>.<variant>.png。
图像生成计费(火山方舟)。

用法:
  uv run style_test.py --project sanguo guan_yu zhuge_liang diao_chan
"""

from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

# 复用 generate_portraits 的 client / MODEL / generate_one / ProjectCtx
sys.path.insert(0, str(Path(__file__).parent))
from generate_portraits import ROOT, ProjectCtx, generate_one  # noqa: E402

# 三种候选风格(共享锁定约束:全身/2:3/头部置上/标志武器坐骑入画/麻纸底/中国古风/无边框印章文字)
STYLE_VARIANTS: dict[str, str] = {
    "A_厚涂写实": (
        "卡牌全身立绘构图,2:3竖向,全身像、头部置于画面上部、全身立于画幅中央,"
        "以厚涂写实油画笔触为主,强烈明暗对比与戏剧化侧逆光,质感真实(铠甲/丝帛/皮革),"
        "背景为做旧麻纸(古绢)质感叠极淡水墨战场远景(淡墨远山、隐约战旗狼烟),"
        "中国汉末三国古风浓郁,拥有标志性兵器或坐骑的人物持械、骑乘其坐骑,"
        "色彩浓郁沉稳,不画任何边框/相框/印章/文字,画面边缘自然过渡到麻纸背景,史诗厚重"
    ),
    "B_国风工笔水墨": (
        "卡牌全身立绘构图,2:3竖向,全身像、头部置于画面上部、全身立于画幅中央,"
        "中国工笔重彩结合水墨写意,线描精细、设色典雅古朴、墨晕与留白并用,"
        "背景为宣纸做旧质感叠水墨远山江景,浓郁国画气韵,"
        "中国汉末三国古风,拥有标志性兵器或坐骑的人物持械、骑乘其坐骑,"
        "不画任何边框/相框/印章/文字,画面边缘自然晕染过渡,古雅飘逸而具英雄气"
    ),
    "C_连环画卡牌": (
        "卡牌全身立绘构图,2:3竖向,全身像、头部置于画面上部、全身立于画幅中央,"
        "三国杀卡牌插画与经典三国连环画上色风格,轮廓硬朗、色彩浓烈饱和、装饰性强、明暗块面分明,"
        "背景为做旧麻纸叠淡墨战旗烽烟,鲜明的商业插画质感,"
        "中国汉末三国古风,拥有标志性兵器或坐骑的人物持械、骑乘其坐骑,"
        "不画任何边框/相框/印章/文字,英雄气概张扬"
    ),
    "D_Q版萌系": (
        "Q版萌系卡通造型,二至三头身比例,大头大眼、身形圆润可爱、表情生动,"
        "厚涂上色但造型卡通萌化,2:3竖向,头部置于画面上部、全身立于画幅中央,"
        "中国汉末三国古风服饰简化但保留标志特征(关羽绿袍长髯、诸葛亮纶巾羽扇、貂蝉襦裙),"
        "拥有标志性兵器或坐骑者以萌化迷你形态呈现(如迷你赤兔马、卡通化青龙偃月刀),"
        "背景为做旧麻纸叠极淡水墨远景,色彩明快讨喜,"
        "不画任何边框/相框/印章/文字,可爱呆萌而不失三国韵味"
    ),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("slugs", nargs="+", help="要试水的人物 slug")
    args = ap.parse_args()

    ctx = ProjectCtx(args.project)
    out_dir = ROOT / "projects" / args.project / "images" / "_style_test"
    out_dir.mkdir(parents=True, exist_ok=True)

    jobs = [(slug, vname, vstyle) for slug in args.slugs for vname, vstyle in STYLE_VARIANTS.items()]
    print(f"试水 {len(args.slugs)} 人 × {len(STYLE_VARIANTS)} 风格 = {len(jobs)} 张 → {out_dir}\n")

    for slug, vname, vstyle in jobs:
        desc = ctx.prompts.get(slug)
        if not desc:
            print(f"  ✗ {slug}: prompts.json 无该 slug,跳过")
            continue
        out_path = out_dir / f"{slug}.{vname}.png"
        if out_path.exists():
            print(f"  · {slug} [{vname}] 已存在,跳过")
            continue
        print(f"  {slug} [{vname}] 生成中...")
        t0 = time.time()
        try:
            raw = generate_one(slug, desc, base_style=vstyle)
            out_path.write_bytes(raw)
            print(f"  ✓ {slug} [{vname}]: {time.time()-t0:.1f}s → {out_path.name}")
        except Exception as e:
            print(f"  ✗ {slug} [{vname}]: {type(e).__name__} — {e}")
        time.sleep(0.5)

    print(f"\n完成。请查看 {out_dir} 下 9 张图比对风格。")


if __name__ == "__main__":
    main()
