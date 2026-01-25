import logging
from abc import ABC, abstractmethod
from datetime import datetime, date

import akshare as ak

from src.models.market import MarketCode, StockData, IndexData

logger = logging.getLogger(__name__)


class BaseCollector(ABC):
    """数据采集器抽象基类"""

    market: MarketCode

    @abstractmethod
    async def get_index_data(self) -> list[IndexData]:
        """获取大盘指数"""
        ...

    @abstractmethod
    async def get_stock_data(self, symbols: list[str]) -> list[StockData]:
        """获取个股行情"""
        ...


class AkshareCollector(BaseCollector):
    """基于 akshare 的数据采集器，支持 A 股和 H 股"""

    def __init__(self, market: MarketCode):
        if market == MarketCode.US:
            raise NotImplementedError("美股数据采集暂未实现")
        self.market = market

    async def get_index_data(self) -> list[IndexData]:
        """获取大盘指数数据"""
        if self.market == MarketCode.CN:
            return self._get_cn_index()
        elif self.market == MarketCode.HK:
            return self._get_hk_index()
        return []

    async def get_stock_data(self, symbols: list[str]) -> list[StockData]:
        """获取个股行情"""
        if self.market == MarketCode.CN:
            return self._get_cn_stocks(symbols)
        elif self.market == MarketCode.HK:
            return self._get_hk_stocks(symbols)
        return []

    def _today_str(self) -> str:
        return date.today().strftime("%Y%m%d")

    def _get_cn_index(self) -> list[IndexData]:
        """获取 A 股主要指数（使用日线历史接口）"""
        indices = []
        index_list = [
            ("000001", "上证指数"),
            ("399001", "深证成指"),
            ("399006", "创业板指"),
        ]
        today = self._today_str()

        for symbol, name in index_list:
            try:
                df = ak.stock_zh_index_daily_em(symbol=f"sh{symbol}" if symbol.startswith("0") else f"sz{symbol}")
                if df.empty:
                    continue
                row = df.iloc[-1]
                prev_close = float(row.get("open", row.get("close", 0)))
                close = float(row.get("close", 0))
                indices.append(IndexData(
                    symbol=symbol,
                    name=name,
                    market=MarketCode.CN,
                    current_price=close,
                    change_pct=float(row.get("close", 0) - row.get("open", 0)) / max(float(row.get("open", 1)), 1) * 100,
                    change_amount=float(row.get("close", 0)) - float(row.get("open", 0)),
                    volume=float(row.get("volume", 0)),
                    turnover=0,
                    timestamp=datetime.now(),
                ))
            except Exception as e:
                logger.error(f"获取指数 {name}({symbol}) 失败: {e}")

        return indices

    def _get_hk_index(self) -> list[IndexData]:
        """获取港股主要指数"""
        indices = []
        # 使用恒生指数历史数据
        try:
            df = ak.stock_hk_index_daily_em(symbol="HSI")
            if not df.empty:
                row = df.iloc[-1]
                close = float(row.get("close", row.get("收盘", 0)))
                open_price = float(row.get("open", row.get("开盘", 0)))
                indices.append(IndexData(
                    symbol="HSI",
                    name="恒生指数",
                    market=MarketCode.HK,
                    current_price=close,
                    change_pct=(close - open_price) / max(open_price, 1) * 100,
                    change_amount=close - open_price,
                    volume=float(row.get("volume", row.get("成交量", 0))),
                    turnover=0,
                    timestamp=datetime.now(),
                ))
        except Exception as e:
            logger.error(f"获取恒生指数失败: {e}")

        return indices

    def _get_cn_stocks(self, symbols: list[str]) -> list[StockData]:
        """获取 A 股个股行情（使用日线历史接口）"""
        stocks = []
        today = self._today_str()

        for symbol in symbols:
            try:
                df = ak.stock_zh_a_hist(
                    symbol=symbol, period="daily",
                    start_date=today, end_date=today, adjust=""
                )
                if df.empty:
                    # 今天可能不是交易日，取最近一天
                    df = ak.stock_zh_a_hist(
                        symbol=symbol, period="daily", adjust=""
                    )
                if df.empty:
                    logger.warning(f"A股 {symbol} 无数据")
                    continue

                row = df.iloc[-1]
                stocks.append(StockData(
                    symbol=symbol,
                    name="",  # hist 接口不返回名称，后续用 watchlist 配置补充
                    market=MarketCode.CN,
                    current_price=float(row.get("收盘", 0)),
                    change_pct=float(row.get("涨跌幅", 0)),
                    change_amount=float(row.get("涨跌额", 0)),
                    volume=float(row.get("成交量", 0)),
                    turnover=float(row.get("成交额", 0)),
                    open_price=float(row.get("开盘", 0)),
                    high_price=float(row.get("最高", 0)),
                    low_price=float(row.get("最低", 0)),
                    prev_close=float(row.get("收盘", 0)) - float(row.get("涨跌额", 0)),
                    timestamp=datetime.now(),
                ))
            except Exception as e:
                logger.error(f"获取 A 股 {symbol} 行情失败: {e}")

        return stocks

    def _get_hk_stocks(self, symbols: list[str]) -> list[StockData]:
        """获取港股个股行情（使用日线历史接口）"""
        stocks = []
        today = self._today_str()

        for symbol in symbols:
            try:
                df = ak.stock_hk_hist(
                    symbol=symbol, period="daily",
                    start_date=today, end_date=today, adjust=""
                )
                if df.empty:
                    df = ak.stock_hk_hist(
                        symbol=symbol, period="daily", adjust=""
                    )
                if df.empty:
                    logger.warning(f"港股 {symbol} 无数据")
                    continue

                row = df.iloc[-1]
                close = float(row.get("收盘", 0))
                prev_close = close - float(row.get("涨跌额", 0)) if "涨跌额" in row else float(row.get("开盘", 0))
                stocks.append(StockData(
                    symbol=symbol,
                    name="",
                    market=MarketCode.HK,
                    current_price=close,
                    change_pct=float(row.get("涨跌幅", 0)),
                    change_amount=float(row.get("涨跌额", 0)) if "涨跌额" in row else close - prev_close,
                    volume=float(row.get("成交量", 0)),
                    turnover=float(row.get("成交额", 0)) if "成交额" in row else 0,
                    open_price=float(row.get("开盘", 0)),
                    high_price=float(row.get("最高", 0)),
                    low_price=float(row.get("最低", 0)),
                    prev_close=prev_close,
                    timestamp=datetime.now(),
                ))
            except Exception as e:
                logger.error(f"获取港股 {symbol} 行情失败: {e}")

        return stocks
