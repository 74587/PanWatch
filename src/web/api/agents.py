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


@router.delete("/{agent_name}")
def delete_agent(agent_name: str, db: Session = Depends(get_db)):
    """删除 Agent 配置"""
    agent = db.query(AgentConfig).filter(AgentConfig.name == agent_name).first()
    if not agent:
        raise HTTPException(404, f"Agent {agent_name} 不存在")

    # 删除关联的 stock_agents 记录
    from src.web.models import StockAgent
    db.query(StockAgent).filter(StockAgent.agent_name == agent_name).delete()

    db.delete(agent)
    db.commit()
    return {"ok": True, "message": f"Agent {agent_name} 已删除"}


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
    实时扫描所有自选股的异动情况（供首页调用）

    Args:
        analyze: 是否调用 AI 分析生成操作建议（默认 False）
    """
    from server import (
        load_watchlist_for_agent,
        load_portfolio_for_agent,
        _get_proxy,
        resolve_ai_model,
        _build_ai_client,
    )
    from src.config import Settings
    from src.collectors.akshare_collector import AkshareCollector
    from src.models.market import MarketCode, MARKETS

    agent_name = "intraday_monitor"
    watchlist = load_watchlist_for_agent(agent_name)

    # 如果盘中监测没有关联股票，使用 daily_report 的
    if not watchlist:
        watchlist = load_watchlist_for_agent("daily_report")

    if not watchlist:
        return {"alerts": [], "message": "无自选股", "scanned_count": 0, "alert_count": 0}

    # 检查是否有市场在交易
    any_trading = any(m.is_trading_time() for m in MARKETS.values())
    if not any_trading:
        return {
            "alerts": [],
            "message": "当前非交易时段",
            "scanned_count": len(watchlist),
            "alert_count": 0,
            "is_trading": False,
        }

    # 获取持仓信息
    portfolio = load_portfolio_for_agent(agent_name)
    if not portfolio.accounts:
        portfolio = load_portfolio_for_agent("daily_report")

    # 按市场分组采集行情
    market_symbols: dict[MarketCode, list] = {}
    symbol_to_stock = {}
    for stock in watchlist:
        market_symbols.setdefault(stock.market, []).append(stock.symbol)
        symbol_to_stock[stock.symbol] = stock

    all_quotes = []
    for market_code, symbols in market_symbols.items():
        try:
            collector = AkshareCollector(market_code)
            stocks = await collector.get_stock_data(symbols)
            all_quotes.extend(stocks)
        except Exception as e:
            logger.error(f"采集 {market_code.value} 行情失败: {e}")

    # 检测异动（涨跌幅超过阈值）
    ALERT_THRESHOLD = 3.0  # 涨跌幅超过 3% 视为异动
    alerts = []

    for quote in all_quotes:
        change_pct = quote.change_pct or 0
        if abs(change_pct) < ALERT_THRESHOLD:
            continue

        # 获取持仓信息
        positions = portfolio.get_positions_for_stock(quote.symbol)
        has_position = len(positions) > 0
        cost_price = positions[0].cost_price if positions else None
        trading_style = positions[0].trading_style if positions else None
        pnl_pct = None
        if cost_price and quote.current_price:
            pnl_pct = (quote.current_price - cost_price) / cost_price * 100

        alert_type = "急涨" if change_pct > 0 else "急跌"

        alerts.append({
            "symbol": quote.symbol,
            "name": quote.name,
            "alert_type": alert_type,
            "current_price": quote.current_price,
            "change_pct": change_pct,
            "message": f"{quote.name} {alert_type} {change_pct:+.2f}%",
            "has_position": has_position,
            "cost_price": cost_price,
            "pnl_pct": pnl_pct,
            "trading_style": trading_style,
            "suggestion": None,
        })

    # AI 分析（可选）
    if analyze and alerts:
        settings = Settings()
        proxy = _get_proxy() or settings.http_proxy
        model, service = resolve_ai_model(agent_name)

        if model and service:
            ai_client = _build_ai_client(model, service, proxy)

            for alert in alerts:
                if not alert["has_position"]:
                    continue
                try:
                    prompt = f"""股票 {alert['name']}({alert['symbol']}) 今日{alert['alert_type']}，涨跌幅 {alert['change_pct']:+.2f}%。
当前价格: {alert['current_price']}
持仓成本: {alert['cost_price']}
持仓盈亏: {alert['pnl_pct']:+.1f}%
交易风格: {alert['trading_style'] or '波段'}

请简要分析是否需要操作（20字以内）。"""
                    suggestion = await ai_client.chat("你是股票分析助手，给出简洁建议。", prompt)
                    alert["suggestion"] = suggestion.strip()[:50]
                except Exception as e:
                    alert["suggestion"] = f"分析失败"
                    logger.error(f"AI 分析失败: {e}")

    return {
        "alerts": alerts,
        "scanned_count": len(watchlist),
        "alert_count": len(alerts),
        "is_trading": True,
    }
