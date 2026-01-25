"""新闻速递 Agent - 自选股相关新闻摘要"""
import logging
from datetime import datetime
from pathlib import Path

from src.agents.base import BaseAgent, AgentContext, AnalysisResult
from src.collectors.news_collector import NewsCollector, NewsItem

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "news_digest.txt"


class NewsDigestAgent(BaseAgent):
    """新闻速递 Agent"""

    name = "news_digest"
    display_name = "新闻速递"
    description = "定时抓取与持仓相关的新闻资讯并推送摘要"

    def __init__(self, since_hours: int = 2):
        """
        Args:
            since_hours: 获取最近 N 小时的新闻
        """
        self.since_hours = since_hours

    async def collect(self, context: AgentContext) -> dict:
        """采集新闻（自选股相关 + 重要市场新闻）"""
        symbols = [stock.symbol for stock in context.watchlist]

        if not symbols:
            logger.warning("自选股列表为空，跳过新闻采集")
            return {"news": [], "related_news": [], "watchlist": []}

        collector = NewsCollector()
        news_list = await collector.fetch_all(
            symbols=symbols,
            since_hours=self.since_hours,
        )

        # 分类：自选股相关 + 重要市场新闻
        related_news = self._filter_related_news(news_list, symbols)
        important_news = [n for n in news_list if n.importance >= 2 and n not in related_news]

        return {
            "news": news_list,  # 全部新闻
            "related_news": related_news,  # 自选股相关
            "important_news": important_news,  # 重要市场新闻
            "watchlist": context.watchlist,
            "timestamp": datetime.now().isoformat(),
        }

    def _filter_related_news(self, news_list: list[NewsItem], symbols: list[str]) -> list[NewsItem]:
        """过滤与自选股相关的新闻"""
        related = []
        for news in news_list:
            # 新闻已标注股票
            if news.symbols and any(s in symbols for s in news.symbols):
                related.append(news)
                continue
            # 检查标题/内容是否包含股票代码
            text = news.title + news.content
            if any(s in text for s in symbols):
                related.append(news)

        return related

    def build_prompt(self, data: dict, context: AgentContext) -> tuple[str, str]:
        """构建新闻速递 Prompt"""
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

        lines = []
        lines.append(f"## 时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

        # 自选股列表
        lines.append("## 自选股")
        watchlist_map = {s.symbol: s for s in context.watchlist}
        for stock in context.watchlist:
            lines.append(f"- {stock.name}({stock.symbol})")

        # 自选股相关新闻
        related_news: list[NewsItem] = data.get("related_news", [])
        lines.append(f"\n## 自选股相关新闻 ({len(related_news)} 条)")
        if related_news:
            for news in related_news[:10]:
                self._format_news_item(lines, news, watchlist_map)
        else:
            lines.append("- 暂无自选股相关新闻")

        # 重要市场新闻
        important_news: list[NewsItem] = data.get("important_news", [])
        lines.append(f"\n## 重要市场新闻 ({len(important_news)} 条)")
        if important_news:
            for news in important_news[:10]:
                self._format_news_item(lines, news, watchlist_map)
        else:
            lines.append("- 暂无重要市场新闻")

        user_content = "\n".join(lines)
        return system_prompt, user_content

    def _format_news_item(self, lines: list[str], news: NewsItem, watchlist_map: dict) -> None:
        """格式化单条新闻"""
        importance_label = ["", "[一般]", "[重要]", "[重大]"][min(news.importance, 3)]
        time_str = news.publish_time.strftime("%H:%M")
        source_label = {"sina": "新浪", "eastmoney": "东财"}.get(news.source, news.source)

        # 关联股票名称
        stock_names = []
        for symbol in news.symbols:
            if symbol in watchlist_map:
                stock_names.append(watchlist_map[symbol].name)
        stock_info = f"[{','.join(stock_names)}] " if stock_names else ""

        lines.append(
            f"- {importance_label} [{source_label} {time_str}] {stock_info}{news.title}"
        )
        if news.content and news.content != news.title:
            content_brief = news.content[:100] + ("..." if len(news.content) > 100 else "")
            lines.append(f"  > {content_brief}")

    async def should_notify(self, result: AnalysisResult) -> bool:
        """有自选股相关新闻或重要市场新闻时通知"""
        related_news = result.raw_data.get("related_news", [])
        important_news = result.raw_data.get("important_news", [])

        # 有自选股相关新闻
        if related_news:
            return True
        # 有重要市场新闻
        if important_news:
            return True
        return False
