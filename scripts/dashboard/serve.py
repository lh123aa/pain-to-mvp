#!/usr/bin/env python3
"""
Dashboard Web 服务（纯标准库，零依赖）。
用法：
  python scripts/dashboard/serve.py --port 8787
访问：
  http://localhost:8787
"""
# --- UTF-8 入口稳定化（fix_utf8.py 自动插入） ---
import os as _os
import sys as _sys

_here = _os.path.dirname(_os.path.abspath(__file__))
for _cand in (_here, _os.path.dirname(_here), _os.path.join(_os.path.dirname(_here), "scripts")):
    if _os.path.isdir(_os.path.join(_cand, "pipeline")) and _cand not in _sys.path:
        _sys.path.insert(0, _cand)
        break
try:
    from pipeline.encoding import ensure_utf8

    ensure_utf8()
except Exception:
    pass
# --- 结束 UTF-8 入口稳定化 ---
import argparse
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).parent.parent.parent
DASHBOARD_JSON = ROOT / "data" / "dashboard.json"
ASSETS = ROOT / "assets" / "dashboard"


def resolve_asset(rel: str):
    """把 URL 相对路径解析为 ASSETS 内的文件；越界返回 None（防路径穿越）。"""
    try:
        candidate = (ASSETS / rel).resolve()
        candidate.relative_to(ASSETS.resolve())
    except (ValueError, OSError):
        return None
    return candidate if candidate.is_file() else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # 静默日志，避免刷屏
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        mime, _ = mimetypes.guess_type(str(path))
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send_file(ASSETS / "index.html")
        elif path == "/dashboard.json":
            if DASHBOARD_JSON.exists():
                try:
                    data = json.loads(DASHBOARD_JSON.read_text(encoding="utf-8"))
                except Exception:
                    data = {"error": "invalid dashboard.json"}
            else:
                data = {"last_updated": None, "summary": {}, "requirements": []}
            self._send_json(data)
        elif path == "/health":
            self._send_json({"status": "ok"})
        else:
            # 静态资源（style.css / app.js）——必须防路径穿越
            rel = urlparse(self.path).path.lstrip("/")
            asset = resolve_asset(rel)
            if asset is None:
                self.send_error(403)
                return
            self._send_file(asset)

def main(port, host):
    print(f"🚀 Dashboard 已启动：http://{host}:{port}")
    print(f"   数据源：{DASHBOARD_JSON}")
    print(f"   资产目录：{ASSETS}")
    print(f"   按 Ctrl+C 停止\n")
    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 已停止")
        server.shutdown()

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()
    main(args.port, args.host)
