import logging
import time
from typing import Callable, Awaitable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.agents.base import BaseAgent, AgentContext
from src.core.agent_runs import record_agent_run

logger = logging.getLogger(__name__)


class AgentScheduler:
    """Agent 调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.agents: dict[str, BaseAgent] = {}
        self.execution_modes: dict[str, str] = {}
        # 改为存储 context 构建函数，而非固定 context
        self.context_builder: Callable[[str], AgentContext] | None = None

    def set_context_builder(self, builder: Callable[[str], AgentContext]):
        """设置 context 构建函数（每次执行时动态构建）"""
        self.context_builder = builder

    def register(self, agent: BaseAgent, schedule: str, execution_mode: str = "batch"):
        """
        注册 Agent 到调度器。

        Args:
            agent: Agent 实例
            schedule: 调度表达式
                - cron 格式: "分 时 日 月 周" (5 部分)
                - interval 格式: "interval:3m" 或 "interval:30s"
            execution_mode: 执行模式 batch/single（single 将逐只股票执行 run_single）
        """
        self.agents[agent.name] = agent
        self.execution_modes[agent.name] = execution_mode or "batch"

        # 解析调度表达式
        if schedule.startswith("interval:"):
            trigger = self._parse_interval(schedule)
        else:
            trigger = self._parse_cron(schedule)

        self.scheduler.add_job(
            self._run_agent,
            trigger=trigger,
            args=[agent.name],
            id=agent.name,
            name=agent.display_name,
            replace_existing=True,
        )

        logger.info(f"注册 Agent: {agent.display_name} (schedule: {schedule})")

    def _parse_cron(self, cron: str) -> CronTrigger:
        """解析 cron 表达式（使用北京时间）"""
        parts = cron.split()
        if len(parts) != 5:
            raise ValueError(f"无效的 cron 表达式: {cron}")

        return CronTrigger(
            minute=parts[0],
            hour=parts[1],
            day=parts[2],
            month=parts[3],
            day_of_week=parts[4],
            timezone="Asia/Shanghai",  # 使用北京时间
        )

    def _parse_interval(self, expr: str) -> IntervalTrigger:
        """
        解析 interval 表达式

        格式: interval:3m, interval:30s, interval:1h
        """
        value = expr.replace("interval:", "")
        if value.endswith("s"):
            seconds = int(value[:-1])
            return IntervalTrigger(seconds=seconds)
        elif value.endswith("m"):
            minutes = int(value[:-1])
            return IntervalTrigger(minutes=minutes)
        elif value.endswith("h"):
            hours = int(value[:-1])
            return IntervalTrigger(hours=hours)
        else:
            raise ValueError(f"无效的 interval 表达式: {expr}")

    async def _run_agent(self, agent_name: str):
        """执行指定 Agent（动态构建 context）"""
        if not self.context_builder:
            logger.error("context_builder 未设置")
            return

        agent = self.agents.get(agent_name)
        if not agent:
            logger.error(f"Agent 未找到: {agent_name}")
            return

        start = time.monotonic()
        try:
            # 每次执行时动态构建 context（获取最新配置）
            context = self.context_builder(agent_name)
            logger.info(f"[调度] 开始执行 Agent: {agent.display_name}")
            mode = self.execution_modes.get(agent_name, "batch")
            if mode == "single" and hasattr(agent, "run_single"):
                processed = 0
                errors: list[str] = []
                for stock in list(context.watchlist):
                    try:
                        await agent.run_single(context, stock.symbol)  # type: ignore[attr-defined]
                        processed += 1
                    except Exception as e:
                        logger.error(f"Agent [{agent_name}] 单只执行失败 {stock.symbol}: {e}", exc_info=True)
                        errors.append(f"{stock.symbol}: {e}")
                logger.info(f"[调度] Agent 单只模式执行完成: {agent.display_name}（{processed}/{len(context.watchlist)}）")
                duration_ms = int((time.monotonic() - start) * 1000)
                record_agent_run(
                    agent_name=agent_name,
                    status="failed" if errors else "success",
                    result=f"single mode processed {processed}/{len(context.watchlist)}",
                    error="; ".join(errors),
                    duration_ms=duration_ms,
                )
            else:
                result = await agent.run(context)
                duration_ms = int((time.monotonic() - start) * 1000)
                record_agent_run(
                    agent_name=agent_name,
                    status="success",
                    result=(result.content or "")[:2000],
                    duration_ms=duration_ms,
                )
            logger.info(f"[调度] Agent 执行完成: {agent.display_name}")
        except Exception as e:
            logger.error(f"Agent [{agent_name}] 调度执行异常: {e}", exc_info=True)
            duration_ms = int((time.monotonic() - start) * 1000)
            record_agent_run(
                agent_name=agent_name,
                status="failed",
                error=str(e),
                duration_ms=duration_ms,
            )

    async def trigger_now(self, agent_name: str):
        """立即执行某个 Agent（手动触发）"""
        await self._run_agent(agent_name)

    def start(self):
        """启动调度器"""
        self.scheduler.start()
        logger.info(f"调度器已启动，已注册 {len(self.agents)} 个 Agent")

        # 打印所有已注册的任务
        jobs = self.scheduler.get_jobs()
        for job in jobs:
            logger.info(f"  - {job.name}: 下次执行 {job.next_run_time}")

    def shutdown(self):
        """关闭调度器"""
        self.scheduler.shutdown()
        logger.info("调度器已关闭")
