"""Agent 运行记录 - 写入 agent_runs 表（供 UI 查询）"""
import logging

from src.web.database import SessionLocal
from src.web.models import AgentRun

logger = logging.getLogger(__name__)


def record_agent_run(
    agent_name: str,
    status: str,
    result: str = "",
    error: str = "",
    duration_ms: int = 0,
) -> None:
    """记录一次 Agent 运行结果到数据库。

    Args:
        agent_name: Agent 名称
        status: success / failed
        result: 简要结果（会截断）
        error: 错误信息（会截断）
        duration_ms: 执行耗时（毫秒）
    """
    db = SessionLocal()
    try:
        db.add(AgentRun(
            agent_name=agent_name,
            status=status,
            result=(result or "")[:2000],
            error=(error or "")[:2000],
            duration_ms=duration_ms,
        ))
        db.commit()
    except Exception as e:
        logger.warning(f"写入 AgentRun 失败: {e}")
        db.rollback()
    finally:
        db.close()

