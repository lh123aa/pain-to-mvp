#!/usr/bin/env python3
"""B站 WBI 签名算法。

2023 年后 B站 web 接口（搜索、评论等）要求携带 w_rid 签名，否则返回
-403/风控码。本模块实现官方公开的 WBI 签名流程：

1. GET /x/web-interface/nav 取 wbi_img.img_url / sub_url 末段作为 img_key/sub_key
2. 按固定换位表 MIXIN_KEY_ENC_TAB 混合出 32 位 mixin_key
3. 请求参数加 wts（秒级时间戳），按键名字典序排序后 urlencode
4. w_rid = md5(排序后的查询串 + mixin_key)
"""

import hashlib
import time
from urllib.parse import urlencode

NAV_URL = "https://api.bilibili.com/x/web-interface/nav"

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
    20, 34, 44, 52,
]


def get_mixin_key(img_key: str, sub_key: str) -> str:
    """按官方换位表混合 img_key + sub_key，取前 32 位。"""
    raw = (img_key or "") + (sub_key or "")
    return "".join(raw[i] for i in MIXIN_KEY_ENC_TAB if i < len(raw))[:32]


def enc_wbi(params: dict, img_key: str, sub_key: str) -> dict:
    """给参数加 wts + w_rid 签名，返回新 dict（不改入参）。"""
    signed = dict(params)
    signed["wts"] = int(time.time())
    query = urlencode(sorted(signed.items()))
    signed["w_rid"] = hashlib.md5((query + get_mixin_key(img_key, sub_key)).encode("utf-8")).hexdigest()
    return signed
