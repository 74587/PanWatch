import logging
import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from src.agents.base import BaseAgent, AgentContext

logger = logging.getLogger(__name__)


class AgentScheduler:
    """Agent 调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.agents: dict[str, BaseAgent] = {}
        self.context: AgentContext | None = None

    def set_context(self, context: AgentContext):
        self.context = context

    def register(self, agent: BaseAgent, cron: str):
        """
        注册 Agent 到调度器。

        Args:
            agent: Agent 实例
            cron: cron 表达式（分 时 日 月 周）
        """
        self.agents[agent.name] = agent

        # 解析 cron 表达式
        parts = cron.split()
        if len(parts) != 5:
            raise ValueError(f"无效的 cron 表达式: {cron}")

        trigger = CronTrigger(
            minute=parts[0],
            hour=parts[1],
            day=parts[2],
            month=parts[3],
            day_of_week=parts[4],
        )

        self.scheduler.add_job(
            self._run_agent,
            trigger=trigger,
            args=[agent.name],
            id=agent.name,
            name=agent.display_name,
            replace_existing=True,
        )

        logger.info(f"注册 Agent: {agent.display_name} (cron: {cron})")

    async def _run_agent(self, agent_name: str):
        """执行指定 Agent"""
        if not self.context:
            logger.error("AgentContext 未设置")
            return

        agent = self.agents.get(agent_name)
        if not agent:
            logger.error(f"Agent 未找到: {agent_name}")
            return

        try:
            await agent.run(self.context)
        except Exception as e:
            logger.error(f"Agent [{agent_name}] 调度执行异常: {e}")

    async def trigger_now(self, agent_name: str):
        """立即执行某个 Agent（手动触发）"""
        await self._run_agent(agent_name)

    def start(self):
        """启动调度器"""
        self.scheduler.start()
        logger.info(f"调度器已启动，已注册 {len(self.agents)} 个 Agent")

    def shutdown(self):
        """关闭调度器"""
        self.scheduler.shutdown()
        logger.info("调度器已关闭")
