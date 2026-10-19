# -*- coding: utf-8 -*-
"""T7：MCP 服务器（scripts/mcp_server.py）协议与工具测试。"""
import json
import os
import subprocess
import sys
from pathlib import Path

import mcp_server

ROOT = Path(__file__).resolve().parents[1]


def _call(mid, method, params=None):
    msg = {"jsonrpc": "2.0", "id": mid, "method": method}
    if params is not None:
        msg["params"] = params
    return mcp_server.handle_message(msg)


def test_initialize_echoes_protocol_and_capabilities():
    resp = _call(1, "initialize", {"protocolVersion": "2025-06-18"})
    assert resp["result"]["protocolVersion"] == "2025-06-18"
    assert "tools" in resp["result"]["capabilities"]
    assert resp["result"]["serverInfo"]["name"] == "pain-to-mvp"


def test_initialized_notification_gets_no_reply():
    assert mcp_server.handle_message({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_tools_list_schema():
    resp = _call(2, "tools/list")
    tools = resp["result"]["tools"]
    names = [t["name"] for t in tools]
    assert names == ["list_reports", "get_report", "search_reports",
                     "get_service_info", "generate_landing_page"]
    get_report = next(t for t in tools if t["name"] == "get_report")
    assert get_report["inputSchema"]["required"] == ["slug"]
    assert "001-backend-miniprogram" in get_report["inputSchema"]["properties"]["slug"]["enum"]


def test_list_reports_returns_four_with_meta():
    resp = _call(3, "tools/call", {"name": "list_reports", "arguments": {}})
    assert resp["result"]["isError"] is False
    items = json.loads(resp["result"]["content"][0]["text"])
    assert len(items) == 4
    first = items[0]
    assert first["slug"] == "001-backend-miniprogram"
    assert first["score"] and first["comments"] == 112
    assert first["summary"]


def test_get_report_ok_and_unknown_slug():
    resp = _call(4, "tools/call", {"name": "get_report",
                                   "arguments": {"slug": "001-backend-miniprogram"}})
    text = resp["result"]["content"][0]["text"]
    assert "# " in text and "付费意愿信号（WTP）" in text

    bad = _call(5, "tools/call", {"name": "get_report", "arguments": {"slug": "nope"}})
    assert bad["result"]["isError"] is True
    assert "未知报告" in bad["result"]["content"][0]["text"]


def test_search_reports_hits_wtp():
    resp = _call(6, "tools/call", {"name": "search_reports",
                                   "arguments": {"query": "付费意愿"}})
    data = json.loads(resp["result"]["content"][0]["text"])
    assert data["count"] >= 4  # 四份报告都有 WTP 节
    assert all(h["slug"] for h in data["hits"])


def test_get_service_info_contains_pricing():
    resp = _call(7, "tools/call", {"name": "get_service_info", "arguments": {}})
    text = resp["result"]["content"][0]["text"]
    assert "199" in text and "深度" in text


def test_generate_landing_page_text_and_output_path(tmp_path):
    args = {"headline": "测试主张", "pain_points": ["「痛点一」"], "cta_text": "预约"}
    resp = _call(8, "tools/call", {"name": "generate_landing_page", "arguments": args})
    html = resp["result"]["content"][0]["text"]
    assert "<html" in html and "测试主张" in html and "痛点一" in html

    out = tmp_path / "lp.html"
    resp2 = _call(9, "tools/call", {"name": "generate_landing_page",
                                    "arguments": {**args, "output_path": str(out)}})
    assert "已写入" in resp2["result"]["content"][0]["text"]
    assert out.read_text(encoding="utf-8") == html


def test_unknown_tool_and_method_are_errors():
    bad_tool = _call(10, "tools/call", {"name": "nope", "arguments": {}})
    assert bad_tool["error"]["code"] == -32602
    bad_method = _call(11, "some/unknown")
    assert bad_method["error"]["code"] == -32601


def test_stdio_end_to_end():
    """端到端：真实进程 + stdio 传输（模拟 AI 助手客户端调用存量数据）。"""
    script = ROOT / "scripts" / "mcp_server.py"
    env = {**os.environ, "PYTHONUTF8": "1"}
    proc = subprocess.Popen(
        [sys.executable, str(script)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", env=env,
    )
    for msg in (
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2025-06-18"}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
         "params": {"name": "list_reports", "arguments": {}}},
    ):
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()
    out, _ = proc.communicate(timeout=60)
    lines = [json.loads(l) for l in out.splitlines() if l.strip()]
    assert [l["id"] for l in lines] == [1, 2]  # 通知不回包
    assert lines[0]["result"]["serverInfo"]["name"] == "pain-to-mvp"
    items = json.loads(lines[1]["result"]["content"][0]["text"])
    assert len(items) == 4
