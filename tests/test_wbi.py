"""B站 WBI 签名、游标分页、风控降级测试。"""
from unittest import mock

import pytest

from wbi import get_mixin_key, enc_wbi


@pytest.fixture
def requests_only():
    """这些测试关注 WBI/分页/风控逻辑（mock 在 session 上），
    强制走 requests 路径，避免被 Scrapling 传输层绕过 mock。"""
    import adapters.bilibili as bili
    with mock.patch.object(bili, "_SCRAPLING", None):
        yield


def test_mixin_key_deterministic_32_chars():
    mk = get_mixin_key("7cd084941338484aae1ad9425b84077c",
                       "4932ebaff29c73fa60ce326a3b7d5a7a")
    assert len(mk) == 32
    assert mk == get_mixin_key("7cd084941338484aae1ad9425b84077c",
                               "4932ebaff29c73fa60ce326a3b7d5a7a")


def test_enc_wbi_adds_signature_and_is_order_independent():
    a = enc_wbi({"keyword": "test", "mid": 1}, "1" * 32, "2" * 32)
    b = enc_wbi({"mid": 1, "keyword": "test"}, "1" * 32, "2" * 32)
    assert "wts" in a and "w_rid" in a
    assert a["w_rid"] == b["w_rid"]


def _make_replies(prefix, n):
    return [{
        "rpid": f"{prefix}-{i}",
        "content": {"message": f"评论{prefix}-{i} 求教程"},
        "member": {"uname": f"user_{i}"},
        "like": i,
        "rcount": 0,
        "ctime": 1700000000 + i,
    } for i in range(n)]


class _FakeResp:
    def __init__(self, data):
        self._data = data
    def json(self):
        return self._data


class _FakeSession:
    """模拟 requests.Session：按调用次序返回两页评论。"""
    def __init__(self):
        self.calls = []
    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params})
        n = len(self.calls)
        if n == 1:
            return _FakeResp({"data": {"replies": _make_replies("p1", 20),
                                      "cursor": {"next": "CURSOR-1"}}})
        return _FakeResp({"data": {"replies": _make_replies("p2", 15),
                                   "cursor": {"next": 0}}})


def test_crawl_pagination_uses_cursor_not_page_number(requests_only):
    from adapters.bilibili import BilibiliAdapter
    from scripts.pipeline.compliance import RateLimiter

    adapter = BilibiliAdapter()
    adapter.session = _FakeSession()
    adapter._wbi_keys = lambda: ("a" * 32, "b" * 32)
    adapter.limiter = RateLimiter(0.0)

    comments = adapter.crawl_comments("123", limit=30)

    assert len(comments) == 30, f"两页合并后应按 limit 截断为 30 条，实际 {len(comments)}"
    reply_calls = [c for c in adapter.session.calls if "reply" in c["url"]]
    assert len(reply_calls) == 2, f"应请求两页，实际 {len(reply_calls)}"
    assert reply_calls[1]["params"]["next"] == "CURSOR-1", \
        f"第二页必须使用游标，实际 next={reply_calls[1]['params'].get('next')}"
    assert reply_calls[1]["params"].get("w_rid"), "WBI 签名缺失"
    ids = {c["id"] for c in comments}
    assert len(ids) == 30, "评论 id 必须唯一"


def test_discover_failure_does_not_break_pipeline(monkeypatch, tmp_path):
    """回归守卫：平台风控失败时 discover 不得抛未处理异常（不能崩）。

    契约升级（OPEN_ISSUES #28，2026-10-15）：旧断言"返回 [] 继续"已被证伪——
    exit 0 + 空文件会被 e2e 当成功，把真失败推给下游误报。新契约：零发现
    必须 sys.exit(1) 点名失败平台（fail-close），仍不抛 RuntimeError 裸崩。
    """
    import adapters.bilibili as bili
    import discover_content

    def boom(self, keyword, limit=20):
        raise RuntimeError("风控 -352")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(bili.BilibiliAdapter, "discover", boom)
    with pytest.raises(SystemExit) as exc:
        discover_content.discover("kw", ["bilibili"], 5)
    assert exc.value.code != 0, "零发现却 exit 0——空文件假成功（NFR 4.1 违例）"


def test_v_voucher_risk_control_raises_clear_error(requests_only):
    """风控真实验票（v_voucher）必须抛清晰错误，不静默返回空、不绕过验证码。"""
    from adapters.bilibili import BilibiliAdapter
    from scripts.pipeline.compliance import RateLimiter

    adapter = BilibiliAdapter()

    class _Resp:
        def json(self):
            return {"code": 0, "message": "OK", "data": {"v_voucher": "risk-token"}}

    class _Sess:
        def get(self, url, params=None, timeout=None):
            return _Resp()

    adapter.session = _Sess()
    adapter._wbi_keys = lambda: ("a" * 32, "b" * 32)
    adapter.limiter = RateLimiter(0.0)

    try:
        adapter.discover("kw", 5)
        raise AssertionError("v_voucher 风控响应必须抛错，不能静默返回空")
    except RuntimeError as e:
        assert "风控" in str(e), f"错误信息需说明风控：{e}"
