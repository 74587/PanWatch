"""标的元信息注入单测 — 修复 LLM 在 A 股 ticker 上瞎编公司的问题。"""

from __future__ import annotations

from src.agents.tradingagents.portfolio_context import build_stock_metadata_context
from src.agents.tradingagents.toolkit_adapter import (
    _PANWATCH_DATA_CACHE,
    _stock_meta_header,
    _serve_from_panwatch,
    panwatch_data_context,
)


class _FakeStock:
    def __init__(self, name, symbol, market_value):
        self.name = name
        self.symbol = symbol
        self.market = type("M", (), {"value": market_value})()


def test_metadata_context_has_company_name():
    """meta context 必须包含公司中文名,LLM 不会瞎编"""
    ctx = build_stock_metadata_context(
        stock_symbol="601127",
        stock_name="赛力斯",
        market="CN",
        current_price=83.26,
    )
    assert "赛力斯" in ctx
    assert "601127" in ctx
    assert "A 股" in ctx
    assert "83.26" in ctx
    assert "DO NOT guess" in ctx  # 强制约束


def test_metadata_context_includes_industry():
    """如有行业,加进上下文"""
    ctx = build_stock_metadata_context(
        stock_symbol="601127",
        stock_name="赛力斯",
        market="CN",
        industry="汽车制造",
    )
    assert "汽车制造" in ctx


def test_metadata_context_empty_symbol_returns_empty():
    """空 symbol → 空串"""
    assert build_stock_metadata_context(stock_symbol="") == ""


def test_metadata_context_us_market_label():
    """美股市场标签正确渲染"""
    ctx = build_stock_metadata_context(stock_symbol="AAPL", stock_name="Apple", market="US")
    assert "美股" in ctx


def test_stock_meta_header_from_cache():
    """工具返回前缀包含公司名(来自 _PANWATCH_DATA_CACHE)"""
    stock = _FakeStock("赛力斯", "601127", "CN")
    quote = {"current_price": 83.26, "change_pct": -2.5, "industry": "汽车"}
    with panwatch_data_context({"stock": stock, "quote": quote}):
        header = _stock_meta_header("601127")
    assert "赛力斯" in header
    assert "601127" in header
    assert "中国 A 股" in header
    assert "83.26" in header
    assert "汽车" in header
    assert "DO NOT guess" in header


def test_serve_fundamentals_includes_company_name():
    """fundamentals 工具返回必须带公司名,避免 LLM 把 601127 当中国平安"""
    stock = _FakeStock("赛力斯", "601127", "CN")
    with panwatch_data_context({"stock": stock, "quote": {"current_price": 83.26}}):
        result = _serve_from_panwatch("get_fundamentals_openai", "601127", {})
    assert "赛力斯" in result
    assert "601127" in result


def test_serve_news_empty_does_not_leak_global_news():
    """新闻为空时,工具返回明确说"没有个股新闻",阻止 LLM 拉无关全球新闻"""
    stock = _FakeStock("广汽集团", "601238", "CN")
    with panwatch_data_context({"stock": stock, "events": []}):
        result = _serve_from_panwatch("get_news", "601238", {})
    assert "广汽集团" in result
    assert "DO NOT pull unrelated global news" in result


def test_serve_klines_empty_returns_company_aware_message():
    """K 线为空时返回明确空提示,带公司名"""
    stock = _FakeStock("赛力斯", "601127", "CN")
    with panwatch_data_context({"stock": stock, "klines": []}):
        result = _serve_from_panwatch("get_stockstats_indicators", "601127", {})
    assert "赛力斯" in result
    assert "601127" in result


def test_serve_klines_with_data_returns_csv():
    """K 线有数据时返回 CSV,前缀带公司名"""
    stock = _FakeStock("赛力斯", "601127", "CN")
    klines = [type("K", (), {"date": "2026-05-15", "open": 80, "high": 85, "low": 79, "close": 83.26, "volume": 1000})()]
    with panwatch_data_context({"stock": stock, "klines": klines}):
        result = _serve_from_panwatch("get_stockstats_indicators", "601127", {})
    assert "赛力斯" in result
    assert "2026-05-15,80,85,79,83.26,1000" in result
