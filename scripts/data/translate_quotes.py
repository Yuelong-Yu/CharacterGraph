"""
后处理：把名言里残留的英文/古希腊文翻译为中文（保留文献出处）

策略：
  - 扫描所有 18 个 character JSON
  - 凡是 quotes[*].text 中文字符占比 < 50% 的，调 LLM 译为中文（保留原文学色彩）
  - 保留 source 字段不变
  - 译完直接覆写文件

调 LLM 走和 extract_structured.py 一样的火山方舟兼容 Anthropic API。
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from llm_client import call_json
from project_io import add_project_arg, characters_dir, load_config


def is_mostly_zh(s: str) -> bool:
    if not s.strip():
        return True
    cn = sum(1 for c in s if "一" <= c <= "鿿")
    return cn / max(1, len(s.strip())) >= 0.5


def build_system(domain: str) -> str:
    return f"""你是「{domain}」的古典文献译者。任务:把英文/外文的引语翻译为优美、忠实于原意的中文。

原则:
1. 保留古典文献的庄重感和诗意,不要现代口语化。
2. 保留人名、地名的标准中文译名。
3. 翻译要符合中文阅读习惯,可以适当调整句序,但不增加不译之意。
4. 不要加任何解释或注释。

输出严格 JSON 对象:{{"text": "翻译后的中文"}}"""


def translate(system: str, name: str, text: str, source: dict) -> str:
    src_label = f"《{source.get('work', '')}》{source.get('locus', '')}" if source else ""
    user = f"""请翻译此处《{name}》的引语为中文。

原文:{text}

出处:{src_label}

输出 JSON: {{"text": "中文翻译"}}"""
    data = call_json(system, user, max_tokens=1024)
    return data["text"]


def main() -> None:
    ap = argparse.ArgumentParser()
    add_project_arg(ap)
    args = ap.parse_args()

    config = load_config(args.project)
    char_dir = characters_dir(args.project)
    system = build_system(config.title)

    for path in sorted(char_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not data.get("quotes"):
            continue
        dirty = False
        for q in data["quotes"]:
            text = q.get("text", "")
            if is_mostly_zh(text):
                continue
            print(f"[{data['id']}] 翻译:{text[:60]}...")
            try:
                new_text = translate(system, data["name_zh"], text, q.get("source", {}))
                print(f"   → {new_text[:60]}...")
                q["text"] = new_text
                dirty = True
            except Exception as e:
                print(f"   ✗ {type(e).__name__}: {e}")
        if dirty:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"   ✓ 保存 {path.name}")


if __name__ == "__main__":
    main()
