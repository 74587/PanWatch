"""新闻采集器 - 财联社电报 + 东方财富公告"""
import logging
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)


@dataclass
class NewsItem:
    """新闻数据结构"""
    source: str           # "cls" / "eastmoney"
    external_id: str      # 来源侧唯一ID
    title: str
    content: str
    publish_time: datetime
    symbols: list[str] = field(default_factory=list)  # 关联股票代码
    importance: int = 0   # 0-3 重要性


class BaseNewsCollector(ABC):
    """新闻采集器抽象基类"""

    source: str = ""

    @abstractmethod
    async def fetch_news(self, symbols: list[str] | None = None, since: datetime | None = None) -> list[NewsItem]:
        """
        获取新闻列表

        Args:
            symbols: 过滤的股票代码列表（可选）
            since: 只获取此时间之后的新闻（可选）

        Returns:
            NewsItem 列表
        """
        ...


class SinaNewsCollector(BaseNewsCollector):
    """
    新浪财经 7x24 快讯采集器

    API: https://zhibo.sina.com.cn/api/zhibo/feed
    特点: 实时财经快讯，免费无需认证，稳定可靠
    """

    source = "sina"
    API_URL = "https://zhibo.sina.com.cn/api/zhibo/feed"

    async def fetch_news(self, symbols: list[str] | None = None, since: datetime | None = None) -> list[NewsItem]:
        """
        获取新浪财经快讯

        注意：新浪快讯是通用财经新闻，不按股票代码过滤
        symbols 参数仅用于标记相关股票，不作为过滤条件
        """
        params = {
            "page": 1,
            "page_size": 50,
            "zhibo_id": 152,  # 财经直播间
            "tag_id": 0,
            "type": 0,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(self.API_URL, params=params)
                resp.raise_for_status()
                data = resp.json()

            if data.get("result", {}).get("status", {}).get("code") != 0:
                logger.warning(f"新浪快讯 API 返回错误: {data}")
                return []

            items = data.get("result", {}).get("data", {}).get("feed", {}).get("list", [])
            result = []

            for item in items:
                try:
                    news = self._parse_item(item)
                    if news:
                        # 时间过滤
                        if since and news.publish_time < since:
                            continue
                        # 标记与自选股相关的新闻（但不过滤）
                        if symbols:
                            self._mark_related_symbols(news, symbols)
                        result.append(news)
                except Exception as e:
                    logger.debug(f"解析新浪快讯失败: {e}")

            logger.info(f"新浪快讯采集到 {len(result)} 条新闻")
            return result

        except Exception as e:
            logger.error(f"新浪快讯采集失败: {e}")
            return []

    def _parse_item(self, item: dict) -> NewsItem | None:
        """解析单条新闻"""
        external_id = str(item.get("id", ""))
        if not external_id:
            return None

        # rich_text 包含标题和内容，格式为【标题】内容
        rich_text = item.get("rich_text", "") or ""

        # 清理 HTML 标签
        rich_text = re.sub(r"<[^>]+>", "", rich_text).strip()

        if not rich_text:
            return None

        # 提取标题（【】内的内容）
        title_match = re.match(r"【(.+?)】(.+)", rich_text, re.DOTALL)
        if title_match:
            title = title_match.group(1).strip()
            content = title_match.group(2).strip()
        else:
            title = rich_text[:50]
            content = rich_text

        # 解析时间
        create_time = item.get("create_time", "")
        try:
            publish_time = datetime.strptime(create_time, "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            publish_time = datetime.now()

        # 从内容中提取股票代码
        symbols = self._extract_symbols(content)

        # 重要性判断
        importance = 0
        if item.get("is_top"):
            importance = 3
        elif any(k in title for k in ["重磅", "突发", "紧急", "重大"]):
            importance = 2
        elif any(k in title for k in ["快讯", "消息", "公告"]):
            importance = 1

        return NewsItem(
            source=self.source,
            external_id=external_id,
            title=title,
            content=content,
            publish_time=publish_time,
            symbols=symbols,
            importance=importance,
        )

    def _extract_symbols(self, text: str) -> list[str]:
        """从文本中提取股票代码"""
        # 匹配 6 位数字（股票代码）
        codes = re.findall(r"\b(\d{6})\b", text)
        # 过滤掉不像股票代码的数字
        valid_codes = [c for c in codes if c.startswith(("0", "3", "6"))]
        return list(set(valid_codes))

    def _mark_related_symbols(self, news: NewsItem, symbols: list[str]) -> None:
        """标记新闻相关的自选股"""
        text = news.title + news.content
        for symbol in symbols:
            if symbol in text and symbol not in news.symbols:
                news.symbols.append(symbol)

    def _match_symbols(self, news: NewsItem, symbols: list[str]) -> bool:
        """检查新闻是否与股票列表相关"""
        if not symbols:
            return True
        if not news.symbols:
            # 无标注股票时，检查标题/内容是否包含股票代码
            text = news.title + news.content
            return any(s in text for s in symbols)
        return any(s in news.symbols for s in symbols)


class EastMoneyNewsCollector(BaseNewsCollector):
    """
    东方财富公告采集器

    API: https://np-anotice-stock.eastmoney.com/api/security/ann
    特点: 个股公告，按股票代码查询
    """

    source = "eastmoney"
    API_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann"

    async def fetch_news(self, symbols: list[str] | None = None, since: datetime | None = None) -> list[NewsItem]:
        """获取东方财富公告"""
        if not symbols:
            logger.debug("东方财富公告需要指定股票代码")
            return []

        all_news = []
        for symbol in symbols:
            news_list = await self._fetch_for_symbol(symbol, since)
            all_news.extend(news_list)

        logger.info(f"东方财富采集到 {len(all_news)} 条公告")
        return all_news

    async def _fetch_for_symbol(self, symbol: str, since: datetime | None) -> list[NewsItem]:
        """获取单只股票的公告"""
        # 东方财富 API 直接使用 6 位股票代码
        stock_code = symbol

        params = {
            "sr": -1,
            "page_size": 30,
            "page_index": 1,
            "ann_type": "A",  # A=全部
            "stock_list": stock_code,
            "f_node": 0,
            "s_node": 0,
        }

        try:
            async with httpx.AsyncClient(timeout=15, verify=False) as client:
                resp = await client.get(self.API_URL, params=params)
                resp.raise_for_status()
                data = resp.json()

            if not data.get("success"):
                logger.warning(f"东方财富 API 返回错误: {data}")
                return []

            items = data.get("data", {}).get("list", [])
            result = []

            for item in items:
                try:
                    news = self._parse_item(item, symbol)
                    if news:
                        if since and news.publish_time < since:
                            continue
                        result.append(news)
                except Exception as e:
                    logger.debug(f"解析东方财富公告失败: {e}")

            return result

        except Exception as e:
            logger.error(f"东方财富公告采集失败 ({symbol}): {e}")
            return []

    def _parse_item(self, item: dict, symbol: str) -> NewsItem | None:
        """解析单条公告"""
        external_id = str(item.get("art_code", ""))
        if not external_id:
            return None

        title = item.get("title", "")
        if not title:
            return None

        # 解析时间
        notice_date = item.get("notice_date", "")
        try:
            publish_time = datetime.strptime(notice_date, "%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            try:
                publish_time = datetime.strptime(notice_date[:10], "%Y-%m-%d")
            except (ValueError, TypeError):
                publish_time = datetime.now()

        # 重要性判断
        importance = 0
        columns = item.get("columns", []) or []
        column_names = [c.get("column_name", "") for c in columns]
        if any(k in title for k in ["重大", "业绩预告", "业绩快报", "年报", "半年报"]):
            importance = 3
        elif any(k in title for k in ["季报", "分红", "增持", "减持"]):
            importance = 2
        elif "临时" in str(column_names):
            importance = 1

        return NewsItem(
            source=self.source,
            external_id=external_id,
            title=title,
            content="",  # 公告通常只有标题，内容需另外获取
            publish_time=publish_time,
            symbols=[symbol],
            importance=importance,
        )


class NewsCollector:
    """聚合新闻采集器"""

    def __init__(self, collectors: list[BaseNewsCollector] | None = None):
        self.collectors = collectors or [
            SinaNewsCollector(),
            EastMoneyNewsCollector(),
        ]

    async def fetch_all(
        self,
        symbols: list[str] | None = None,
        since_hours: int = 2,
    ) -> list[NewsItem]:
        """
        聚合所有数据源的新闻

        Args:
            symbols: 股票代码列表
            since_hours: 获取最近 N 小时的新闻（快讯类）

        Returns:
            按时间倒序排列的新闻列表
        """
        # 快讯类使用较短的时间窗口
        news_since = datetime.now() - timedelta(hours=since_hours)
        # 公告类使用较长的时间窗口（24小时）
        announcement_since = datetime.now() - timedelta(hours=24)

        all_news: list[NewsItem] = []

        for collector in self.collectors:
            try:
                # 东方财富公告使用更长的时间窗口
                if collector.source == "eastmoney":
                    since = announcement_since
                else:
                    since = news_since
                news_list = await collector.fetch_news(symbols, since)
                all_news.extend(news_list)
            except Exception as e:
                logger.error(f"采集器 {collector.source} 失败: {e}")

        # 按时间倒序 + 重要性倒序排列
        all_news.sort(key=lambda x: (x.publish_time, x.importance), reverse=True)

        # 去重（按 source + external_id）
        seen = set()
        unique_news = []
        for news in all_news:
            key = (news.source, news.external_id)
            if key not in seen:
                seen.add(key)
                unique_news.append(news)

        return unique_news
