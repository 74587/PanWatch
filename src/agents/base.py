import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime

from src.core.ai_client import AIClient
from src.core.notifier import NotifierManager
from src.config import AppConfig, StockConfig

logger = logging.getLogger(__name__)


@dataclass
class AgentContext:
    """Agent 运行时上下文"""
    ai_client: AIClient
    notifier: NotifierManager
    config: AppConfig

    @property
    def watchlist(self) -> list[StockConfig]:
        return self.config.watchlist


@dataclass
class AnalysisResult:
    """分析结果"""
    agent_name: str
    title: str
    content: str
    raw_data: dict = field(default_factory=dict)
    images: list[str] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)


class BaseAgent(ABC):
    """Agent 抽象基类"""

    name: str = ""
    display_name: str = ""
    description: str = ""

    @abstractmethod
    async def collect(self, context: AgentContext) -> dict:
        """采集数据"""
        ...

    @abstractmethod
    def build_prompt(self, data: dict, context: AgentContext) -> tuple[str, str]:
        """
        构建 prompt。

        Returns:
            (system_prompt, user_content)
        """
        ...

    async def analyze(self, context: AgentContext, data: dict) -> AnalysisResult:
        """调用 AI 分析"""
        system_prompt, user_content = self.build_prompt(data, context)
        content = await context.ai_client.chat(system_prompt, user_content)
        return AnalysisResult(
            agent_name=self.name,
            title=f"【{self.display_name}】",
            content=content,
            raw_data=data,
        )

    async def should_notify(self, result: AnalysisResult) -> bool:
        """是否需要通知，子类可重写"""
        return True

    async def run(self, context: AgentContext) -> AnalysisResult:
        """标准执行流程"""
        logger.info(f"Agent [{self.display_name}] 开始执行")

        try:
            data = await self.collect(context)
            result = await self.analyze(context, data)

            if await self.should_notify(result):
                await context.notifier.notify(
                    result.title,
                    result.content,
                    result.images,
                )
                logger.info(f"Agent [{self.display_name}] 通知已发送")
            else:
                logger.info(f"Agent [{self.display_name}] 无需通知")

            return result

        except Exception as e:
            logger.error(f"Agent [{self.display_name}] 执行失败: {e}")
            raise
