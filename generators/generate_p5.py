
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pain-to-MVP 项目生成器 - P5
Dashboard 展示端：Web 服务 + 动态看板 + 进度更新
运行：python generate_p5.py
"""
from pathlib import Path

FILES = {}

# ============================================================
# scripts/dashboard/serve.py
# ============================================================
FILES["scripts/dashboard/serve.py"] = r'''#!/usr/bin/env python3
"""
Dashboard Web 服务（纯标准库，零依赖）。
用法：
  python scripts/dashboard/serve.py --port 8787
访问：
  http://localhost:8787
"""
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
            # 静态资源（style.css / app.js）
            rel = path.lstrip("/")
            self._send_file(ASSETS / rel)

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
'''

# ============================================================
# scripts/dashboard/update_progress.py
# ============================================================
FILES["scripts/dashboard/update_progress.py"] = r'''#!/usr/bin/env python3
"""
更新单个需求的进度。
用法：
  python update_progress.py --id 20261011-001 --status analyzing --progress 45 --stage "痛点提炼完成" --next "机会评分"
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

DASHBOARD = Path("data/dashboard.json")

VALID_STATUS = ["discovered", "analyzing", "mvp_design", "validating", "completed", "dropped", "in_progress"]

def _load():
    if DASHBOARD.exists():
        return json.loads(DASHBOARD.read_text(encoding="utf-8"))
    return {"last_updated": None, "summary": {}, "requirements": []}

def _save(db):
    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")

def _refresh_summary(db):
    reqs = db.get("requirements", [])
    db["summary"] = {
        "total": len(reqs),
        "in_progress": sum(1 for r in reqs if r.get("status") in ("in_progress", "analyzing", "mvp_design", "validating")),
        "completed": sum(1 for r in reqs if r.get("status") == "completed"),
        "dropped": sum(1 for r in reqs if r.get("status") == "dropped"),
        "high_score": sum(1 for r in reqs if (r.get("score") or 0) >= 70),
    }
    db["last_updated"] = datetime.now().isoformat()

def update(req_id, status=None, progress=None, stage=None, next_action=None, note=None):
    db = _load()
    found = False
    for r in db.get("requirements", []):
        if r.get("id") == req_id:
            found = True
            if status:
                if status not in VALID_STATUS:
                    print(f"⚠️ 未知状态：{status}，可选：{VALID_STATUS}")
                r["status"] = status
            if progress is not None:
                r["progress"] = max(0, min(100, int(progress)))
            if stage:
                r["stage"] = stage
            if next_action:
                r["next_action"] = next_action
            # 时间线
            r.setdefault("timeline", []).append({
                "timestamp": datetime.now().isoformat(),
                "status": r.get("status"),
                "progress": r.get("progress"),
                "stage": r.get("stage"),
                "note": note,
            })
            break

    if not found:
        print(f"⚠️ 未找到需求：{req_id}")
        return False

    _refresh_summary(db)
    _save(db)
    print(f"✅ 已更新 {req_id}")
    return True

def add_requirement(req_id, title, score=None, status="discovered", stage="新发现", quotes=None):
    """新增一个需求"""
    db = _load()
    if any(r.get("id") == req_id for r in db.get("requirements", [])):
        print(f"⚠️ {req_id} 已存在")
        return False
    db.setdefault("requirements", []).append({
        "id": req_id,
        "title": title,
        "status": status,
        "progress": 5,
        "stage": stage,
        "score": score,
        "representative_quotes": quotes or [],
        "discovered_at": datetime.now().isoformat(),
        "timeline": [{"timestamp": datetime.now().isoformat(), "status": status, "progress": 5, "stage": stage}],
    })
    _refresh_summary(db)
    _save(db)
    print(f"➕ 新增 {req_id}")
    return True

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True)
    p.add_argument("--status")
    p.add_argument("--progress", type=int)
    p.add_argument("--stage")
    p.add_argument("--next")
    p.add_argument("--note")
    args = p.parse_args()
    update(args.id, args.status, args.progress, args.stage, args.next, args.note)
'''

# ============================================================
# scripts/dashboard/write_dashboard.py
# ============================================================
FILES["scripts/dashboard/write_dashboard.py"] = r'''#!/usr/bin/env python3
"""
从 data/cards/ 目录的 Markdown 卡片重建 dashboard.json。
用法：
  python write_dashboard.py
"""
import json
import re
from datetime import datetime
from pathlib import Path

CARD_DIR = Path("data/cards")
DASHBOARD = Path("data/dashboard.json")

def _parse_card(path: Path) -> dict:
    """从 Markdown 卡片解析基本信息"""
    text = path.read_text(encoding="utf-8")
    card = {
        "id": path.stem,
        "title": "",
        "status": "discovered",
        "progress": 10,
        "stage": "新发现",
        "score": None,
        "representative_quotes": [],
        "discovered_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        "card_path": str(path),
        "timeline": [],
    }

    # 标题
    m = re.search(r"- \*\*标题\*\*：(.+)", text)
    if m:
        card["title"] = m.group(1).strip()

    # 状态
    m = re.search(r"- \*\*状态\*\*：(\w+)", text)
    if m:
        card["status"] = m.group(1).strip()

    # 机会分
    m = re.search(r"- \*\*机会分\*\*：([\d.]+)/100", text)
    if m:
        try:
            card["score"] = float(m.group(1))
        except ValueError:
            pass

    # 代表原话
    for line in text.splitlines():
        if line.startswith("- 「") and line.endswith("」"):
            card["representative_quotes"].append(line[2:-1])
            if len(card["representative_quotes"]) >= 3:
                break

    # 评分明细
    scores = {}
    for dim, key in [("需求强度", "demand"), ("竞争空缺", "competition"),
                     ("个人可行性", "feasibility"), ("触达难度", "reach"), ("AI杠杆", "ai_leverage")]:
        m = re.search(rf"\| {dim} \| (\d+)/5 \|", text)
        if m:
            scores[key] = int(m.group(1))
    if scores:
        card["scores"] = scores

    return card

def rebuild():
    reqs = []
    if CARD_DIR.exists():
        for p in sorted(CARD_DIR.glob("*.md")):
            try:
                reqs.append(_parse_card(p))
            except Exception as e:
                print(f"⚠️ 解析失败：{p} - {e}")

    # 按分数降序
    reqs.sort(key=lambda x: x.get("score") or 0, reverse=True)

    db = {
        "last_updated": datetime.now().isoformat(),
        "summary": {
            "total": len(reqs),
            "in_progress": sum(1 for r in reqs if r["status"] in ("in_progress", "analyzing", "mvp_design", "validating")),
            "completed": sum(1 for r in reqs if r["status"] == "completed"),
            "dropped": sum(1 for r in reqs if r["status"] == "dropped"),
            "high_score": sum(1 for r in reqs if (r.get("score") or 0) >= 70),
        },
        "requirements": reqs,
    }

    DASHBOARD.parent.mkdir(parents=True, exist_ok=True)
    DASHBOARD.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ 已重建 dashboard.json：{len(reqs)} 个需求")
    return db

if __name__ == "__main__":
    rebuild()
'''

# ============================================================
# assets/dashboard/index.html
# ============================================================
FILES["assets/dashboard/index.html"] = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pain-to-MVP Dashboard</title>
<style>
:root {
  --bg: #0f1115;
  --panel: #171a21;
  --panel-2: #1f232b;
  --border: #262b35;
  --text: #e6e8ee;
  --text-dim: #8a92a3;
  --accent: #4f8cff;
  --green: #3ecf8e;
  --yellow: #f2c94c;
  --red: #eb5757;
  --purple: #a259ff;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg);
  color: var(--text);
  padding: 24px;
  line-height: 1.5;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}
.title { font-size: 22px; font-weight: 600; }
.title span { color: var(--accent); }
.last-updated { font-size: 12px; color: var(--text-dim); }
.dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--green);
  margin-right: 6px;
  animation: pulse 1.6s infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px 16px;
}
.stat .label { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
.stat .value { font-size: 24px; font-weight: 600; }
.stat.accent .value { color: var(--accent); }
.stat.green .value { color: var(--green); }
.stat.yellow .value { color: var(--yellow); }
.stat.red .value { color: var(--red); }

.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.filter {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.filter:hover { border-color: var(--accent); }
.filter.active { background: var(--accent); border-color: var(--accent); color: white; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  transition: border-color 0.15s, transform 0.15s;
}
.card:hover { border-color: var(--accent); }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
  gap: 8px;
}
.card-id { font-size: 11px; color: var(--text-dim); font-family: monospace; }
.card-title { font-size: 15px; font-weight: 600; margin-top: 2px; }
.badge {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 5px;
  white-space: nowrap;
  font-weight: 500;
}
.badge.in_progress, .badge.analyzing, .badge.mvp_design, .badge.validating { background: rgba(79,140,255,0.15); color: var(--accent); }
.badge.completed { background: rgba(62,207,142,0.15); color: var(--green); }
.badge.dropped { background: rgba(235,87,87,0.15); color: var(--red); }
.badge.discovered { background: rgba(242,201,76,0.15); color: var(--yellow); }

.card-meta {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 10px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.card-meta .score { color: var(--purple); font-weight: 600; }

.quote {
  font-size: 12px;
  color: var(--text-dim);
  font-style: italic;
  padding: 6px 10px;
  background: var(--panel-2);
  border-left: 2px solid var(--border);
  border-radius: 4px;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-wrap { margin-top: 10px; }
.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.progress-bar {
  height: 6px;
  background: var(--panel-2);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--purple));
  transition: width 0.4s ease;
  border-radius: 3px;
}
.stage {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 6px;
}

.next-action {
  font-size: 12px;
  color: var(--text);
  background: var(--panel-2);
  padding: 6px 10px;
  border-radius: 5px;
  margin-top: 10px;
}
.next-action::before { content: "→ "; color: var(--accent); font-weight: 600; }

.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-dim);
}
.empty h2 { font-size: 16px; font-weight: 500; margin-bottom: 8px; }
.empty p { font-size: 13px; }
.empty code {
  background: var(--panel);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  color: var(--accent);
}
.footer {
  margin-top: 30px;
  text-align: center;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
</head>
<body>
<div class="header">
  <div class="title">🎯 <span>Pain-to-MVP</span> Dashboard</div>
  <div class="last-updated">
    <span class="dot"></span>
    <span id="last-updated">加载中…</span>
  </div>
</div>

<div class="stats" id="stats">
  <div class="stat accent"><div class="label">总需求</div><div class="value" id="s-total">-</div></div>
  <div class="stat yellow"><div class="label">进行中</div><div class="value" id="s-in-progress">-</div></div>
  <div class="stat green"><div class="label">已完成</div><div class="value" id="s-completed">-</div></div>
  <div class="stat red"><div class="label">已放弃</div><div class="value" id="s-dropped">-</div></div>
  <div class="stat"><div class="label">高分（≥70）</div><div class="value" id="s-high">-</div></div>
</div>

<div class="toolbar" id="toolbar">
  <button class="filter active" data-filter="all">全部</button>
  <button class="filter" data-filter="in_progress">进行中</button>
  <button class="filter" data-filter="completed">已完成</button>
  <button class="filter" data-filter="discovered">新发现</button>
  <button class="filter" data-filter="dropped">已放弃</button>
</div>

<div class="grid" id="grid"></div>

<div class="empty" id="empty" style="display:none">
  <h2>还没有需求</h2>
  <p>运行：<code>python scripts/pipeline/run_all.py --keyword "你的关键词" --platforms bilibili</code></p>
</div>

<div class="footer">
  Pain-to-MVP v5.0 · 自动刷新每 3 秒 · 本地数据
</div>

<script src="/app.js"></script>
</body>
</html>
'''

# ============================================================
# assets/dashboard/app.js
# ============================================================
FILES["assets/dashboard/app.js"] = r'''// Pain-to-MVP Dashboard - 前端脚本
const REFRESH_INTERVAL = 3000;
let currentFilter = "all";
let cache = null;

const STATUS_LABELS = {
  "discovered": "新发现",
  "in_progress": "进行中",
  "analyzing": "分析中",
  "mvp_design": "MVP设计中",
  "validating": "验证中",
  "completed": "已完成",
  "dropped": "已放弃",
};

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { hour12: false });
  } catch { return iso; }
}

function renderStats(summary) {
  summary = summary || {};
  document.getElementById("s-total").textContent = summary.total ?? 0;
  document.getElementById("s-in-progress").textContent = summary.in_progress ?? 0;
  document.getElementById("s-completed").textContent = summary.completed ?? 0;
  document.getElementById("s-dropped").textContent = summary.dropped ?? 0;
  document.getElementById("s-high").textContent = summary.high_score ?? 0;
}

function renderCard(req) {
  const status = req.status || "discovered";
  const statusLabel = STATUS_LABELS[status] || status;
  const progress = req.progress ?? 0;
  const score = req.score != null ? Number(req.score).toFixed(1) : "—";
  const quotes = (req.representative_quotes || []).slice(0, 2);
  const stage = req.stage || "";
  const next = req.next_action || "";

  const quotesHtml = quotes.map(q => `<div class="quote">「${esc(q)}」</div>`).join("");

  return `
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-id">${esc(req.id)}</div>
          <div class="card-title">${esc(req.title) || "未命名需求"}</div>
        </div>
        <span class="badge ${status}">${statusLabel}</span>
      </div>
      <div class="card-meta">
        <span class="score">⭐ ${score}</span>
        <span>📅 ${fmtTime(req.discovered_at)}</span>
      </div>
      ${quotesHtml}
      <div class="progress-wrap">
        <div class="progress-label">
          <span>进度</span>
          <span>${progress}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${progress}%"></div>
        </div>
        <div class="stage">${esc(stage)}</div>
      </div>
      ${next ? `<div class="next-action">${esc(next)}</div>` : ""}
    </div>
  `;
}

function applyFilter(reqs) {
  if (currentFilter === "all") return reqs;
  if (currentFilter === "in_progress") {
    return reqs.filter(r => ["in_progress", "analyzing", "mvp_design", "validating"].includes(r.status));
  }
  return reqs.filter(r => r.status === currentFilter);
}

function render(data) {
  renderStats(data.summary);
  document.getElementById("last-updated").textContent = fmtTime(data.last_updated);

  const reqs = applyFilter(data.requirements || []);
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");

  if (!data.requirements || data.requirements.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  if (reqs.length === 0) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:40px"><p>该分类下暂无需求</p></div>`;
    return;
  }

  grid.innerHTML = reqs.map(renderCard).join("");
}

async function fetchData() {
  try {
    const r = await fetch("/dashboard.json", { cache: "no-store" });
    const data = await r.json();
    cache = data;
    render(data);
  } catch (e) {
    document.getElementById("last-updated").textContent = "⚠️ 连接失败";
  }
}

function setupFilters() {
  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      if (cache) render(cache);
    });
  });
}

// 启动
setupFilters();
fetchData();
setInterval(fetchData, REFRESH_INTERVAL);
'''

# ============================================================
# scripts/dashboard/__init__.py
# ============================================================
FILES["scripts/dashboard/__init__.py"] = r'''# dashboard package
'''

# ============================================================
# scripts/dashboard/run_pipeline_with_dashboard.sh
# ============================================================
FILES["scripts/dashboard/run_pipeline_with_dashboard.sh"] = r'''#!/usr/bin/env bash
# 一键启动：后台跑 pipeline + 前台起看板
# 用法：bash scripts/dashboard/run_pipeline_with_dashboard.sh "独立开发者" bilibili

set -e
KEYWORD="${1:-独立开发者}"
PLATFORM="${2:-bilibili}"

echo "🚀 启动 Dashboard（后台）"
python scripts/dashboard/serve.py --port 8787 &
DASH_PID=$!

echo "🔍 开始挖掘：$KEYWORD（平台：$PLATFORM）"
python scripts/pipeline/run_all.py --keyword "$KEYWORD" --platforms "$PLATFORM" --limit 20 --comments 200

echo ""
echo "✅ 挖掘完成，看板仍在运行"
echo "   访问：http://localhost:8787"
echo "   按 Ctrl+C 停止"

wait $DASH_PID
'''


def generate():
    root = Path.cwd()
    print(f"📁 生成 P5 文件到：{root}\n")
    for rel_path, content in FILES.items():
        p = root / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"✅ {rel_path}")

    # 如果 dashboard.json 不存在，初始化一个
    dash = root / "data" / "dashboard.json"
    if not dash.exists():
        dash.parent.mkdir(parents=True, exist_ok=True)
        dash.write_text(
            '{"last_updated": null, "summary": {"total": 0, "in_progress": 0, "completed": 0, "dropped": 0, "high_score": 0}, "requirements": []}',
            encoding="utf-8"
        )
        print("✅ data/dashboard.json（初始化）")

    print("\n🎉 P5 生成完成！")
    print("\n本次生成：")
    print("  - scripts/dashboard/serve.py：Web 服务（纯标准库，零依赖）")
    print("  - scripts/dashboard/update_progress.py：更新单个需求进度")
    print("  - scripts/dashboard/write_dashboard.py：从卡片重建 dashboard.json")
    print("  - assets/dashboard/index.html：看板页面")
    print("  - assets/dashboard/app.js：轮询 + 渲染")
    print("  - scripts/dashboard/run_pipeline_with_dashboard.sh：一键跑通 + 看板")
    print("\n启动方式：")
    print("  # 方式 1：先跑数据，再起看板")
    print("  python scripts/pipeline/run_all.py --keyword '独立开发者' --platforms bilibili --limit 10 --comments 100")
    print("  python scripts/dashboard/serve.py --port 8787")
    print("  # 浏览器打开：http://localhost:8787")
    print("")
    print("  # 方式 2：一键（需要 bash）")
    print("  bash scripts/dashboard/run_pipeline_with_dashboard.sh '独立开发者' bilibili")
    print("")
    print("  # 方式 3：手动加需求（调试用）")
    print("  python scripts/dashboard/update_progress.py --id test-001 --status analyzing --progress 45 --stage '痛点提炼完成' --next '机会评分'")
    print("\n下一步：P6（真实案例验证）")


if __name__ == "__main__":
    generate()
