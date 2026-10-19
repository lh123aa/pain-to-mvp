# -*- coding: utf-8 -*-
"""列表页（index.html）结构回归测试：卡片必须是块级链接（预览时发现的布局 bug）。"""
from generate_reports_html import build_index_html


def test_index_cards_are_block_links():
    html = build_index_html()
    assert 'class="card card-link"' in html
    assert 'style="text-decoration:none;color:inherit"' not in html


def test_index_footer_links_calibration_and_service():
    html = build_index_html()
    assert 'href="calibration.html"' in html
    assert 'href="service.html"' in html


def test_index_lists_all_four_reports():
    html = build_index_html()
    for slug in ("001-backend-miniprogram", "002-promo-bottleneck",
                 "003-landing-page-affordable", "004-overseas-infra"):
        assert f'href="{slug}.html"' in html
