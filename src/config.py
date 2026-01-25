from pathlib import Path
from dataclasses import dataclass, field

import yaml
from pydantic_settings import BaseSettings
from pydantic import Field

from src.models.market import MarketCode


class Settings(BaseSettings):
    """环境变量配置"""

    # AI
    ai_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    ai_api_key: str = ""
    ai_model: str = "glm-4"

    # Telegram
    notify_telegram_bot_token: str = ""
    notify_telegram_chat_id: str = ""

    # 代理
    http_proxy: str = ""

    # SSL 证书（企业环境）
    ca_cert_file: str = ""

    # 调度
    daily_report_cron: str = "30 15 * * 1-5"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@dataclass
class StockConfig:
    """自选股配置"""
    symbol: str
    name: str
    market: MarketCode
    cost_price: float | None = None
    quantity: int | None = None

    @property
    def has_position(self) -> bool:
        return self.cost_price is not None and self.quantity is not None


@dataclass
class AppConfig:
    """应用完整配置"""
    settings: Settings
    watchlist: list[StockConfig] = field(default_factory=list)


def load_watchlist(path: str | Path = "config/watchlist.yaml") -> list[StockConfig]:
    """从 YAML 加载自选股列表"""
    path = Path(path)
    if not path.exists():
        return []

    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    stocks = []
    for market_group in data.get("markets", []):
        market_code = MarketCode(market_group["code"])
        for stock in market_group.get("stocks", []):
            stocks.append(StockConfig(
                symbol=stock["symbol"],
                name=stock["name"],
                market=market_code,
                cost_price=stock.get("cost_price"),
                quantity=stock.get("quantity"),
            ))

    return stocks


def load_config() -> AppConfig:
    """加载完整配置"""
    settings = Settings()
    watchlist = load_watchlist()
    return AppConfig(settings=settings, watchlist=watchlist)
