"""前端单人物生成入口；复用 generate_portraits 的 SeedDream 与裁切管线。"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from generate_portraits import ProjectCtx, generate_one, process_to_portrait_and_thumb

SAFE_KEY = re.compile(r"^[a-z0-9_-]+$")


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}-{time.time_ns()}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", "utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    payload = json.load(sys.stdin)
    project = payload.get("project")
    branch = payload.get("branch")
    character_id = payload.get("characterId")
    prompt = payload.get("prompt")
    fingerprint = payload.get("fingerprint")
    prompt_source = payload.get("promptSource")

    for label, value in (("project", project), ("branch", branch), ("characterId", character_id)):
        if not isinstance(value, str) or not SAFE_KEY.fullmatch(value):
            raise ValueError(f"{label} 不是安全的 slug: {value!r}")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt 不能为空")
    if not isinstance(fingerprint, str) or not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
        raise ValueError("fingerprint 无效")
    if prompt_source not in {"llm", "template"}:
        raise ValueError("promptSource 无效")

    ctx = ProjectCtx(project, branch=branch)
    raw = generate_one(character_id, prompt.strip(), ctx.base_style(character_id))
    print("开始生成 portrait/thumb", file=sys.stderr, flush=True)
    process_to_portrait_and_thumb(raw, character_id, ctx)
    print("portrait/thumb 写入完成", file=sys.stderr, flush=True)

    prompts = dict(ctx.prompts)
    prompts[character_id] = prompt.strip()
    metadata_path = ctx.prompts_path.with_name("prompt-meta.json")
    metadata = json.loads(metadata_path.read_text("utf-8")) if metadata_path.exists() else {}
    metadata[character_id] = {
        "fingerprint": fingerprint,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": prompt_source,
    }
    write_json_atomic(ctx.prompts_path, prompts)
    write_json_atomic(metadata_path, metadata)
    print(json.dumps({
        "ok": True,
        "rawBytes": len(raw),
        "model": os.getenv("IMAGE_MODEL", "doubao-seedream-5.0-lite"),
    }))


if __name__ == "__main__":
    main()
