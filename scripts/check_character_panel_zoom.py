#!/usr/bin/env python3
"""Regression check for the character detail panel at browser-like page zoom.

Start the app first, then run:
  uv run --project scripts/data python scripts/check_character_panel_zoom.py
"""

from __future__ import annotations

import argparse
import sys

from playwright.sync_api import sync_playwright


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


parser = argparse.ArgumentParser()
parser.add_argument(
    "--url",
    default="http://localhost:3000/character-graph/shuihu",
    help="CharacterGraph project URL",
)
args = parser.parse_args()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(args.url, wait_until="networkidle")

    panel = page.locator("[data-character-detail-panel]")
    action = panel.get_by_role("button", name="＋ 添加人物")
    panel_before = panel.bounding_box()
    action_before = action.bounding_box()
    if panel_before is None or action_before is None:
        fail("character detail panel did not render")

    page.evaluate("document.documentElement.style.zoom = '125%'")
    page.wait_for_timeout(100)

    panel_after = panel.bounding_box()
    action_after = action.bounding_box()
    viewport_width = page.evaluate("innerWidth")
    if panel_after is None or action_after is None:
        fail("character detail panel disappeared after zoom")

    panel_right = panel_after["x"] + panel_after["width"]
    if panel_after["x"] < 0 or panel_right > viewport_width + 0.5:
        fail(
            "character detail panel leaves the zoomed viewport "
            f"(viewport={viewport_width}px, panel={panel_after['x']:.0f}..{panel_right:.0f}px)"
        )

    panel_scale = panel_after["width"] / panel_before["width"]
    action_scale = action_after["height"] / action_before["height"]
    if panel_scale < 1.2 or action_scale < 1.2:
        fail(
            "panel or its content did not enlarge with page zoom "
            f"(panel={panel_scale:.2f}x, content={action_scale:.2f}x)"
        )

    position = panel.evaluate("element => getComputedStyle(element).position")
    if position != "fixed":
        fail(f"character detail panel is positioned as {position!r}, expected 'fixed'")

    print(
        "PASS: character detail panel stays in view and its content scales "
        f"(panel={panel_scale:.2f}x, content={action_scale:.2f}x)"
    )
    browser.close()
