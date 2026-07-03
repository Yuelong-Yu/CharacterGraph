"""
LLM 客户端：调火山方舟兼容 Anthropic Messages API 的 deepseek-v4-flash

环境变量（仓库根 .env）：
  CODING_API_KEY   — API key
  CODING_BASE_URL  — https://ark.cn-beijing.volces.com/api/coding
  CODING_MODEL     — deepseek-v4-flash

提供：
  call_json(system, user, max_tokens) → 解析后的 dict（自动去 ```json 围栏）
"""

from __future__ import annotations
import json
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import anthropic
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# 仓库根 .env
ROOT = Path(__file__).parent.parent.parent
load_dotenv(ROOT / ".env")

_API_KEY = os.getenv("CODING_API_KEY")
_BASE_URL = os.getenv("CODING_BASE_URL", "https://ark.cn-beijing.volces.com/api/coding")
_MODEL = os.getenv("CODING_MODEL", "deepseek-v4-flash")

if not _API_KEY:
    raise RuntimeError("CODING_API_KEY 未设置（检查仓库根 .env）")

_client = anthropic.Anthropic(api_key=_API_KEY, base_url=_BASE_URL)

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def _strip_fence(s: str) -> str:
    """去 ```json ... ``` 围栏，如果有。"""
    s = s.strip()
    if s.startswith("```"):
        s = _FENCE_RE.sub("", s).strip()
    return s


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=20),
    retry=retry_if_exception_type((anthropic.APIError, anthropic.APIConnectionError, json.JSONDecodeError)),
)
def call_json(system: str, user: str, max_tokens: int = 8192) -> Any:
    """
    调 LLM，强制返回 JSON。
    返回解析后的 Python 对象（dict / list）。

    模型可能在 content 里返回 thinking 块 + text 块 → 只取 text。
    """
    resp = _client.messages.create(
        model=_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )

    # 把所有 type=="text" 的块拼起来
    text_parts: list[str] = []
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)
    raw = "".join(text_parts)

    cleaned = _strip_fence(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # 模型可能在 JSON 前后多说了话——尝试从第一个 { 或 [ 到对应的结尾切片
        first_brace = min(
            [i for i in [cleaned.find("{"), cleaned.find("[")] if i >= 0],
            default=-1,
        )
        if first_brace >= 0:
            for end_pos in range(len(cleaned), first_brace, -1):
                try:
                    return json.loads(cleaned[first_brace:end_pos])
                except json.JSONDecodeError:
                    continue
        # 实在解析不出，把原文喂回给 retry
        raise json.JSONDecodeError(f"无法从模型回复中解析 JSON: {raw[:200]}", raw, 0)
