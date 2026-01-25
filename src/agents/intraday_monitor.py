"""盘中监测 Agent - 实时监控持仓，AI 判断是否需要提醒"""
import logging
from datetime import datetime, timedelta
from pathlib import Path

from src.agents.base import BaseAgent, AgentContext, AnalysisResult
from src.collectors.akshare_collector import AkshareCollector
from src.models.market import MarketCode, StockData

logger = logging.getLogger(__name__)

PROMPT_PATH = Path(__file__).parent.parent.parent / "prompts" / "intraday_monitor.txt"


class IntradayMonitorAgent(BaseAgent):
    """
    盘中监测 Agent

    特点：
    - 单只模式 (single): 逐只股票分析，每只单独发送通知
    - AI 智能判断: 把股票数据发给 AI，由 AI 决定是否值得提醒
    - 通知节流: 同一股票短时间内不重复通知
    """

    name = "intraday_monitor"
    display_name = "盘中监测"
    description = "交易时段实时监控持仓，AI 判断是否有值得关注的信号"

    def __init__(self, throttle_minutes: int = 30, bypass_throttle: bool = False):
        """
        Args:
            throttle_minutes: 同一股票通知间隔（分钟）
            bypass_throttle: 是否跳过节流（测试用）
        """
        self.throttle_minutes = throttle_minutes
        self.bypass_throttle = bypass_throttle

    async def collect(self, context: AgentContext) -> dict:
        """采集实时行情"""
        if not context.watchlist:
            logger.warning("自选股列表为空，跳过盘中监测")
            return {"stocks": [], "stock_data": None}

        # 按市场分组采集
        market_symbols: dict[MarketCode, list[str]] = {}
        for stock in context.watchlist:
            market_symbols.setdefault(stock.market, []).append(stock.symbol)

        all_stocks: list[StockData] = []
        for market_code, symbols in market_symbols.items():
            collector = AkshareCollector(market_code)
            try:
                stocks = await collector.get_stock_data(symbols)
                all_stocks.extend(stocks)
            except Exception as e:
                logger.error(f"采集 {market_code.value} 行情失败: {e}")

        # 单只模式下只有一只股票
        stock_data = all_stocks[0] if all_stocks else None

        return {
            "stocks": all_stocks,
            "stock_data": stock_data,
            "timestamp": datetime.now().isoformat(),
        }

    def build_prompt(self, data: dict, context: AgentContext) -> tuple[str, str]:
        """构建盘中分析 Prompt"""
        system_prompt = PROMPT_PATH.read_text(encoding="utf-8")

        stock: StockData | None = data.get("stock_data")
        if not stock:
            return system_prompt, "无股票数据"

        # 获取所有账户的持仓信息
        positions = context.portfolio.get_positions_for_stock(stock.symbol)
        style_labels = {"short": "短线", "swing": "波段", "long": "长线"}

        lines = []
        lines.append(f"## 时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

        # 股票行情
        lines.append("## 股票行情")
        lines.append(f"- 股票：{stock.name}（{stock.symbol}）")
        lines.append(f"- 现价：{stock.current_price:.2f}")
        lines.append(f"- 涨跌幅：{stock.change_pct:+.2f}%")
        lines.append(f"- 涨跌额：{stock.change_amount:+.2f}")
        lines.append(f"- 今开：{stock.open_price:.2f}")
        lines.append(f"- 最高：{stock.high_price:.2f}")
        lines.append(f"- 最低：{stock.low_price:.2f}")
        lines.append(f"- 昨收：{stock.prev_close:.2f}")
        if stock.volume > 0:
            lines.append(f"- 成交量：{stock.volume:.0f} 手")
        if stock.turnover > 0:
            lines.append(f"- 成交额：{stock.turnover / 10000:.0f} 万")

        # 各账户持仓信息
        if positions:
            lines.append(f"\n## 持仓情况（共 {len(positions)} 个账户）")
            for i, pos in enumerate(positions, 1):
                pnl_pct = (stock.current_price - pos.cost_price) / pos.cost_price * 100
                style_label = style_labels.get(pos.trading_style, "波段")
                lines.append(f"\n### 持仓 {i}：{pos.account_name}")
                lines.append(f"- 交易风格：{style_label}")
                lines.append(f"- 成本价：{pos.cost_price:.2f}")
                lines.append(f"- 持仓量：{pos.quantity} 股")
                lines.append(f"- 持仓市值：{stock.current_price * pos.quantity:.0f} 元")
                lines.append(f"- 浮动盈亏：{pnl_pct:+.1f}%")
        else:
            lines.append("\n## 未持仓（仅关注）")

        lines.append("\n请分析以上数据，判断是否有值得提醒用户的信号。")

        user_content = "\n".join(lines)
        return system_prompt, user_content

    async def analyze(self, context: AgentContext, data: dict) -> AnalysisResult:
        """AI 分析并判断是否需要提醒"""
        stock: StockData | None = data.get("stock_data")

        if not stock:
            return AnalysisResult(
                agent_name=self.name,
                title=f"【{self.display_name}】无数据",
                content="未获取到股票数据",
                raw_data=data,
            )

        system_prompt, user_content = self.build_prompt(data, context)

        # 打印完整 prompt 用于调试
        logger.info(f"=== Prompt for {stock.symbol} ===\n{user_content}")

        content = await context.ai_client.chat(system_prompt, user_content)

        # 打印 AI 返回结果
        logger.info(f"=== AI Response for {stock.symbol} ===\n{content}")

        # 检查 AI 是否认为需要提醒（在 prompt 中要求 AI 以特定格式回复）
        should_alert = not content.strip().startswith("[无需提醒]")

        # 构建标题
        title = f"【{self.display_name}】{stock.name} {stock.change_pct:+.2f}%"

        # 附 AI 模型信息
        if context.model_label:
            content = content.rstrip() + f"\n\n---\nAI: {context.model_label}"

        return AnalysisResult(
            agent_name=self.name,
            title=title,
            content=content,
            raw_data={
                "stock": {
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "current_price": stock.current_price,
                    "change_pct": stock.change_pct,
                },
                "should_alert": should_alert,
                **data,
            },
        )

    async def should_notify(self, result: AnalysisResult) -> bool:
        """检查是否需要通知"""
        # AI 判断不需要提醒
        if not result.raw_data.get("should_alert", True):
            logger.info(f"AI 判断无需提醒: {result.raw_data.get('stock', {}).get('symbol')}")
            return False

        stock_data = result.raw_data.get("stock")
        if not stock_data:
            return False

        symbol = stock_data.get("symbol")
        if not symbol:
            return False

        # 检查节流（测试模式可跳过）
        if not self.bypass_throttle:
            if not self._check_throttle(symbol):
                logger.info(f"通知节流: {symbol} 在 {self.throttle_minutes} 分钟内已通知")
                return False
            # 更新节流记录
            self._update_throttle(symbol)
        else:
            logger.info(f"跳过节流检查（测试模式）: {symbol}")

        return True

    def _check_throttle(self, symbol: str) -> bool:
        """检查是否可以发送通知（未被节流）"""
        from src.web.database import SessionLocal
        from src.web.models import NotifyThrottle

        db = SessionLocal()
        try:
            record = db.query(NotifyThrottle).filter(
                NotifyThrottle.agent_name == self.name,
                NotifyThrottle.stock_symbol == symbol,
            ).first()

            if not record:
                return True

            # 检查是否超过节流时间
            threshold = datetime.now() - timedelta(minutes=self.throttle_minutes)
            return record.last_notify_at < threshold
        finally:
            db.close()

    def _update_throttle(self, symbol: str):
        """更新节流记录"""
        from src.web.database import SessionLocal
        from src.web.models import NotifyThrottle

        db = SessionLocal()
        try:
            record = db.query(NotifyThrottle).filter(
                NotifyThrottle.agent_name == self.name,
                NotifyThrottle.stock_symbol == symbol,
            ).first()

            now = datetime.now()
            if record:
                # 检查是否是新的一天
                if record.last_notify_at.date() < now.date():
                    record.notify_count = 1
                else:
                    record.notify_count += 1
                record.last_notify_at = now
            else:
                db.add(NotifyThrottle(
                    agent_name=self.name,
                    stock_symbol=symbol,
                    last_notify_at=now,
                    notify_count=1,
                ))

            db.commit()
        finally:
            db.close()

    async def run_single(self, context: AgentContext, stock_symbol: str) -> AnalysisResult | None:
        """
        单只模式执行：只分析指定的一只股票

        用于实时监控场景，每只股票独立分析和通知
        """
        # 过滤只保留指定股票
        original_watchlist = context.config.watchlist
        context.config.watchlist = [s for s in original_watchlist if s.symbol == stock_symbol]

        if not context.config.watchlist:
            return None

        try:
            data = await self.collect(context)
            if not data.get("stock_data"):
                return None

            result = await self.analyze(context, data)

            if await self.should_notify(result):
                await context.notifier.notify(
                    result.title,
                    result.content,
                    result.images,
                )
                logger.info(f"Agent [{self.display_name}] 通知已发送: {stock_symbol}")

            return result
        finally:
            context.config.watchlist = original_watchlist
