# -*- coding: utf-8 -*-
"""生成爱发电用方图封面（800×800 PNG）。

用法（CloakBrowser 专用 venv）：
    $env:PYTHONUTF8='1'
    & "G:\\程序\\CloakBrowser\\.venv\\Scripts\\python.exe" scripts/generate_afdian_covers.py

产物：marketing/afdian/cover-00.png ... cover-04.png
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "marketing" / "afdian" / "covers.html"
OUT = ROOT / "marketing" / "afdian"
IDS = ["cover-00", "cover-01", "cover-02", "cover-03", "cover-04"]


def main() -> int:
    if not SRC.exists():
        print("缺少模板:", SRC)
        return 1
    from cloakbrowser import launch

    browser = launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 900, "height": 900})
        page.goto(SRC.as_uri(), wait_until="load")
        for cid in IDS:
            page.locator(f"#{cid}").screenshot(path=str(OUT / f"{cid}.png"))
            print("ok:", cid, "->", OUT / f"{cid}.png")
    finally:
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
