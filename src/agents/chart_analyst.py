"""技术分析 Agent - 多模态 K 线图分析"""
import logging
from datetime import datetime
from pathlib import Path

from src.agents.base import BaseAgent, AgentContext, AnalysisResult
from src.collectors.screenshot_collector import ScreenshotCollector, ChartScreenshot

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "chart_analyst.txt"


class ChartAnalystAgent(BaseAgent):
    """
    技术分析 Agent

    使用多模态 AI 分析 K 线图截图，输出技术分析报告。
    需要支持 Vision 的 AI 模型（如 GPT-4V、GLM-4V 等）。
    """

    name = "chart_analyst"
    display_name = "技术分析"
    description = "截取 K 线图并使用多模态 AI 进行技术分析"

    def __init__(self, period: str = "daily"):
        """
        Args:
            period: K线周期 (daily/weekly/monthly)
        """
        self.period = period
        self._collector: ScreenshotCollector | None = None

    async def collect(self, context: AgentContext) -> dict:
        """采集自选股 K 线图截图"""
        if not context.watchlist:
            logger.warning("自选股列表为空，跳过截图采集")
            return {"screenshots": [], "watchlist": []}

        # 准备股票列表
        stocks = [
            {
                "symbol": stock.symbol,
                "name": stock.name,
                "market": stock.market.value,
            }
            for stock in context.watchlist
        ]

        # 截图
        self._collector = ScreenshotCollector()
        try:
            screenshots = await self._collector.capture_batch(stocks, period=self.period)

            # 清理旧截图
            self._collector.cleanup_old_screenshots(max_age_hours=24)

            return {
                "screenshots": screenshots,
                "watchlist": context.watchlist,
                "period": self.period,
                "timestamp": datetime.now().isoformat(),
            }
        finally:
            await self._collector.close()
            self._collector = None

    def build_prompt(self, data: dict, context: AgentContext) -> tuple[str, str]:
        """构建技术分析 Prompt"""
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

        lines = []
        lines.append(f"## 分析时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
        lines.append(f"## K线周期：{self._period_label(data.get('period', 'daily'))}\n")

        # 股票列表
        lines.append("## 待分析股票")
        screenshots: list[ChartScreenshot] = data.get("screenshots", [])

        if screenshots:
            for i, shot in enumerate(screenshots, 1):
                lines.append(f"{i}. {shot.name}({shot.symbol}) - 见图{i}")
        else:
            lines.append("- 无截图")

        lines.append("\n请根据上述股票的 K 线图进行技术分析。")

        user_content = "\n".join(lines)
        return system_prompt, user_content

    def _period_label(self, period: str) -> str:
        """周期中文标签"""
        return {
            "daily": "日K",
            "weekly": "周K",
            "monthly": "月K",
        }.get(period, period)

    async def analyze(self, context: AgentContext, data: dict) -> AnalysisResult:
        """
        重写分析方法以支持多模态

        将截图作为图片传给 AI
        """
        system_prompt, user_content = self.build_prompt(data, context)

        # 收集图片路径
        screenshots: list[ChartScreenshot] = data.get("screenshots", [])
        image_paths = [shot.filepath for shot in screenshots if shot.exists]

        if not image_paths:
            logger.warning("没有可用的截图，跳过分析")
            content = "未能获取到 K 线图截图，请检查网络连接或稍后重试。"
        else:
            # 调用多模态 AI
            logger.info(f"使用 {len(image_paths)} 张截图进行多模态分析")
            content = await context.ai_client.chat(
                system_prompt,
                user_content,
                images=image_paths,
            )

        # 构建标题
        stock_names = "、".join(s.name for s in context.watchlist[:5])
        if len(context.watchlist) > 5:
            stock_names += f" 等{len(context.watchlist)}只"
        title = f"【{self.display_name}】{stock_names}"

        # 附 AI 模型信息
        if context.model_label:
            content = content.rstrip() + f"\n\n---\nAI: {context.model_label}"

        return AnalysisResult(
            agent_name=self.name,
            title=title,
            content=content,
            raw_data=data,
            images=image_paths,
        )

    async def should_notify(self, result: AnalysisResult) -> bool:
        """有截图且有内容时通知"""
        screenshots = result.raw_data.get("screenshots", [])
        return len(screenshots) > 0 and len(result.content) > 50
