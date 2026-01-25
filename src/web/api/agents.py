from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.web.database import get_db
from src.web.models import AgentConfig, AgentRun

router = APIRouter()


class AgentConfigUpdate(BaseModel):
    enabled: bool | None = None
    schedule: str | None = None
    ai_model_id: int | None = None
    notify_channel_ids: list[int] | None = None
    config: dict | None = None


class AgentConfigResponse(BaseModel):
    id: int
    name: str
    display_name: str
    description: str
    enabled: bool
    schedule: str
    execution_mode: str  # batch / single
    ai_model_id: int | None
    notify_channel_ids: list[int]
    config: dict

    class Config:
        from_attributes = True


class AgentRunResponse(BaseModel):
    id: int
    agent_name: str
    status: str
    result: str
    error: str
    duration_ms: int
    created_at: str

    class Config:
        from_attributes = True


@router.get("", response_model=list[AgentConfigResponse])
def list_agents(db: Session = Depends(get_db)):
    agents = db.query(AgentConfig).all()
    return [_agent_to_response(a) for a in agents]


def _agent_to_response(agent: AgentConfig) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "display_name": agent.display_name,
        "description": agent.description,
        "enabled": agent.enabled,
        "schedule": agent.schedule or "",
        "execution_mode": agent.execution_mode or "batch",
        "ai_model_id": agent.ai_model_id,
        "notify_channel_ids": agent.notify_channel_ids or [],
        "config": agent.config or {},
    }


@router.put("/{agent_name}", response_model=AgentConfigResponse)
def update_agent(agent_name: str, update: AgentConfigUpdate, db: Session = Depends(get_db)):
    agent = db.query(AgentConfig).filter(AgentConfig.name == agent_name).first()
    if not agent:
        raise HTTPException(404, f"Agent {agent_name} 不存在")

    for key, value in update.model_dump(exclude_unset=True).items():
        setattr(agent, key, value)

    db.commit()
    db.refresh(agent)
    return _agent_to_response(agent)


@router.post("/{agent_name}/trigger")
async def trigger_agent_endpoint(agent_name: str, db: Session = Depends(get_db)):
    """手动触发 Agent 执行"""
    agent = db.query(AgentConfig).filter(AgentConfig.name == agent_name).first()
    if not agent:
        raise HTTPException(404, f"Agent {agent_name} 不存在")
    if not agent.enabled:
        raise HTTPException(400, f"Agent {agent_name} 未启用")

    from server import trigger_agent
    try:
        result = await trigger_agent(agent_name)
        return {"ok": True, "message": result}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Agent 执行失败: {e}")


@router.get("/{agent_name}/history", response_model=list[AgentRunResponse])
def get_agent_history(agent_name: str, limit: int = 20, db: Session = Depends(get_db)):
    return (
        db.query(AgentRun)
        .filter(AgentRun.agent_name == agent_name)
        .order_by(AgentRun.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/intraday/scan")
async def scan_intraday(analyze: bool = False, db: Session = Depends(get_db)):
    """
    实时扫描所有持仓股票的异动情况（供首页调用）

    Args:
        analyze: 是否调用 AI 分析生成操作建议（默认 False）
    """
    from server import (
        load_watchlist_for_agent,
        load_portfolio_for_agent,
        get_agent_config,
        _get_proxy,
        resolve_ai_model,
        _build_ai_client,
    )
    from src.config import Settings, AppConfig
    from src.agents.base import AgentContext, PortfolioInfo
    from src.agents.intraday_monitor import IntradayMonitorAgent
    from src.core.notifier import NotifierManager

    agent_name = "intraday_monitor"
    watchlist = load_watchlist_for_agent(agent_name)

    # 如果盘中监测没有关联股票，使用 daily_report 的
    if not watchlist:
        watchlist = load_watchlist_for_agent("daily_report")

    if not watchlist:
        return {"alerts": [], "message": "无自选股"}

    settings = Settings()
    proxy = _get_proxy() or settings.http_proxy
    portfolio = load_portfolio_for_agent(agent_name)
    if not portfolio.accounts:
        portfolio = load_portfolio_for_agent("daily_report")

    model, service = resolve_ai_model(agent_name)
    ai_client = _build_ai_client(model, service, proxy)

    # 不需要通知，创建空的 notifier
    notifier = NotifierManager()

    config = AppConfig(settings=settings, watchlist=watchlist)
    context = AgentContext(
        ai_client=ai_client,
        notifier=notifier,
        config=config,
        portfolio=portfolio,
        model_label="",
    )

    # 使用配置初始化 Agent
    agent_config = get_agent_config(agent_name)
    agent = IntradayMonitorAgent(**agent_config) if agent_config else IntradayMonitorAgent()

    # 采集和检测异动
    data = await agent.collect(context)
    alerts = data.get("alerts", [])

    # 构建返回结果
    result_alerts = []
    for a in alerts:
        alert_data = {
            "symbol": a.symbol,
            "name": a.name,
            "alert_type": a.alert_type,
            "current_price": a.current_price,
            "change_pct": a.change_pct,
            "message": a.message,
            "has_position": a.has_position,
            "cost_price": a.cost_price,
            "pnl_pct": a.pnl_pct,
            "trading_style": a.trading_style,
            "suggestion": None,
        }

        # 如果需要 AI 分析
        if analyze and a.has_position:
            try:
                # 构建单只股票的 prompt 并调用 AI
                single_data = {"alerts": [a], **data}
                system_prompt, user_content = agent.build_prompt(single_data, context)
                suggestion = await ai_client.chat(system_prompt, user_content)
                alert_data["suggestion"] = suggestion.strip()
            except Exception as e:
                alert_data["suggestion"] = f"分析失败: {e}"

        result_alerts.append(alert_data)

    return {
        "alerts": result_alerts,
        "scanned_count": len(watchlist),
        "alert_count": len(alerts),
    }
