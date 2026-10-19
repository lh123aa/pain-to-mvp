#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pain-to-mvp MCP 服务器（stdio 传输，零依赖纯标准库）。

让任何支持 MCP 的 AI 助手直接调用本仓库的能力（存量数据演示版）：
  - list_reports        列出公开机会报告
  - get_report          读取指定报告全文
  - search_reports      在全部报告中搜索关键词
  - get_service_info    服务说明（价格/权益/流程/FAQ）
  - generate_landing_page  生成需求验证落地页 HTML

配置示例（Claude Desktop / OpenCode 等 MCP 客户端，<REPO> 换成本仓库路径）：
  {"mcpServers": {"pain-to-mvp": {"command": "python",
                                  "args": ["<REPO>/scripts/mcp_server.py"]}}}

协议要点：stdio = 每行一个 JSON-RPC 2.0 消息（MCP JSONL 传输）；
stdout 专供协议消息 —— 所有日志一律走 stderr，绝不污染 stdout。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

from generate_landing_page import build_page  # noqa: E402  （同目录脚本模块）

SERVER_INFO = {"name": "pain-to-mvp", "version": "0.1.0"}

REPORTS = [
    ("001-backend-miniprogram", "exec-report-001-backend-miniprogram.md"),
    ("002-promo-bottleneck", "exec-report-002-promo-bottleneck.md"),
    ("003-landing-page-affordable", "exec-report-003-landing-page-affordable.md"),
    ("004-overseas-infra", "exec-report-004-overseas-infra.md"),
]


# ---------------- 数据读取 ----------------

def _read(rel: str) -> str:
    return (DOCS / rel).read_text(encoding="utf-8")


def _report_meta(slug: str, md: str) -> dict:
    title_m = re.search(r"^# (.+)$", md, re.M)
    score_m = re.search(r"机会分.*?([\d.]+)/100", md)
    comments_m = re.search(r"(\d+) 条真实评论", md)
    summary = ""
    sec = re.search(r"## 一句话结论\s*\n+(.+)", md)
    if sec:
        summary = sec.group(1).strip().strip("*").strip()
    return {
        "slug": slug,
        "title": title_m.group(1).strip() if title_m else slug,
        "score": score_m.group(1) if score_m else None,
        "comments": int(comments_m.group(1)) if comments_m else None,
        "summary": summary,
        "file": f"docs/{dict(REPORTS)[slug]}",
    }


# ---------------- 工具实现 ----------------

def tool_list_reports(_args: dict) -> str:
    items = [_report_meta(slug, _read(fn)) for slug, fn in REPORTS]
    return json.dumps(items, ensure_ascii=False, indent=2)


def tool_get_report(args: dict) -> str:
    slug = str(args.get("slug", ""))
    for s, fn in REPORTS:
        if s == slug:
            return _read(fn)
    raise KeyError(f"未知报告 slug：{slug}（可用：{[s for s, _ in REPORTS]}）")


def tool_search_reports(args: dict) -> str:
    query = str(args.get("query", "")).strip()
    if not query:
        raise KeyError("query 不能为空")
    q = query.lower()
    hits = []
    for slug, fn in REPORTS:
        for i, line in enumerate(_read(fn).splitlines(), 1):
            if q in line.lower():
                hits.append({"slug": slug, "line": i, "text": line.strip()[:200]})
    return json.dumps({"query": query, "count": len(hits), "hits": hits[:30]},
                      ensure_ascii=False, indent=2)


def tool_get_service_info(_args: dict) -> str:
    return _read("service.md")


def tool_generate_landing_page(args: dict) -> str:
    html = build_page(args)
    out_path = args.get("output_path")
    if out_path:
        out = Path(str(out_path))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        return f"已写入 {out}（{len(html)} bytes）"
    return html


TOOL_FUNCS = {
    "list_reports": tool_list_reports,
    "get_report": tool_get_report,
    "search_reports": tool_search_reports,
    "get_service_info": tool_get_service_info,
    "generate_landing_page": tool_generate_landing_page,
}

TOOLS = [
    {
        "name": "list_reports",
        "description": "列出 pain-to-mvp 免费公开机会报告（标题/评分/评论数/一句话结论）。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_report",
        "description": "读取指定机会报告的完整 Markdown 原文（含证据分布、代表原话、WTP、缺口、评分、SOP）。",
        "inputSchema": {
            "type": "object",
            "properties": {"slug": {"type": "string", "enum": [s for s, _ in REPORTS]}},
            "required": ["slug"],
        },
    },
    {
        "name": "search_reports",
        "description": "在全部公开报告中搜索关键词（例如「付费意愿」「落地页」「出海」）。",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "get_service_info",
        "description": "获取服务说明：权益矩阵、价格（含首单验证价）、交付流程与 FAQ。",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "generate_landing_page",
        "description": "按需求信息生成「需求验证落地页」（单文件 HTML，可直接部署）。返回 HTML 文本；给了 output_path 则写入文件。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "headline": {"type": "string", "description": "一句话价值主张（必填）"},
                "subhead": {"type": "string"},
                "audience": {"type": "string", "description": "目标人群描述"},
                "pain_points": {"type": "array", "items": {"type": "string"}, "description": "痛点原话（建议从报告取，匿名）"},
                "value_props": {
                    "type": "array",
                    "items": {"type": "object", "properties": {"title": {"type": "string"}, "desc": {"type": "string"}}},
                },
                "cta_text": {"type": "string"},
                "form_url": {"type": "string", "description": "金数据/腾讯问卷链接；留空则显示占位"},
                "evidence_note": {"type": "string"},
                "output_path": {"type": "string", "description": "可选：写入路径"},
            },
            "required": ["headline"],
        },
    },
]


# ---------------- JSON-RPC 处理 ----------------

def _ok(mid, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _err(mid, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def handle_message(msg: dict):
    """处理一条 JSON-RPC 消息；通知（无 id）返回 None。"""
    mid = msg.get("id")
    method = msg.get("method")
    if mid is None:
        return None  # 通知（如 notifications/initialized）——不需要回复

    if method == "initialize":
        params = msg.get("params") or {}
        proto = params.get("protocolVersion") or "2025-06-18"
        return _ok(mid, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
    if method == "ping":
        return _ok(mid, {})
    if method == "tools/list":
        return _ok(mid, {"tools": TOOLS})
    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        if name not in TOOL_FUNCS:
            return _err(mid, -32602, f"未知工具：{name}")
        try:
            text = TOOL_FUNCS[name](args)
            return _ok(mid, {"content": [{"type": "text", "text": text}], "isError": False})
        except Exception as exc:  # 工具级错误 → 结果内报错（不崩服务器）
            return _ok(mid, {"content": [{"type": "text", "text": f"工具执行失败：{exc}"}], "isError": True})
    return _err(mid, -32601, f"Method not found: {method}")


def main() -> int:
    print("pain-to-mvp MCP server started (stdio, 存量数据演示版)", file=sys.stderr)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            print(f"[warn] 非法 JSON 行已忽略：{line[:80]}", file=sys.stderr)
            continue
        resp = handle_message(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
