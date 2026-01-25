import argparse
import asyncio
import logging
import os
import signal
import sys

from src.config import load_config
from src.core.ai_client import AIClient
from src.core.notifier import NotifierManager, TelegramNotifier
from src.core.scheduler import AgentScheduler
from src.agents.daily_report import DailyReportAgent
from src.agents.base import AgentContext

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def setup_ssl(config):
    """设置 SSL 证书环境（企业代理环境需要）, 模拟 NODE_EXTRA_CA_CERTS 行为"""
    extra_cert = config.settings.ca_cert_file
    if not extra_cert or not os.path.exists(extra_cert):
        return

    import certifi

    # 合并证书输出到 data/ca-bundle.pem（持久化，不用每次重建）
    bundle_path = os.path.join(os.path.dirname(__file__), "data", "ca-bundle.pem")
    os.makedirs(os.path.dirname(bundle_path), exist_ok=True)

    # 检查是否需要重新生成（extra_cert 比 bundle 新时重新生成）
    need_rebuild = (
        not os.path.exists(bundle_path)
        or os.path.getmtime(extra_cert) > os.path.getmtime(bundle_path)
    )

    if need_rebuild:
        certifi_path = certifi.where()
        with open(bundle_path, "w") as out:
            with open(certifi_path, "r") as f:
                out.write(f.read())
            out.write("\n")
            with open(extra_cert, "r") as f:
                out.write(f.read())
        logger.info(f"已生成合并证书: {bundle_path}")

    os.environ["SSL_CERT_FILE"] = bundle_path
    os.environ["REQUESTS_CA_BUNDLE"] = bundle_path
    config.settings.ca_cert_file = bundle_path
    logger.info(f"SSL 证书: {bundle_path}")


def build_context(config) -> AgentContext:
    """构建 Agent 运行上下文"""
    # AI 客户端
    ai_client = AIClient(
        base_url=config.settings.ai_base_url,
        api_key=config.settings.ai_api_key,
        model=config.settings.ai_model,
        proxy=config.settings.http_proxy,
    )

    # 通知管理器
    notifier = NotifierManager()
    if config.settings.notify_telegram_bot_token:
        notifier.add(TelegramNotifier(
            bot_token=config.settings.notify_telegram_bot_token,
            chat_id=config.settings.notify_telegram_chat_id,
            proxy=config.settings.http_proxy,
            ca_cert=config.settings.ca_cert_file,
        ))

    return AgentContext(
        ai_client=ai_client,
        notifier=notifier,
        config=config,
    )


def build_scheduler(context: AgentContext, config) -> AgentScheduler:
    """构建调度器并注册 Agent"""
    scheduler = AgentScheduler()
    scheduler.set_context(context)

    # 注册盘后日报 Agent
    scheduler.register(
        DailyReportAgent(),
        cron=config.settings.daily_report_cron,
    )

    return scheduler


async def run_now(agent_name: str):
    """立即执行指定 Agent"""
    config = load_config()
    setup_ssl(config)
    context = build_context(config)

    scheduler = AgentScheduler()
    scheduler.set_context(context)

    # 注册所有 Agent
    agents = {
        "daily_report": DailyReportAgent(),
    }

    agent = agents.get(agent_name)
    if not agent:
        logger.error(f"未知的 Agent: {agent_name}，可用: {list(agents.keys())}")
        sys.exit(1)

    logger.info(f"手动触发 Agent: {agent.display_name}")
    result = await agent.run(context)
    logger.info(f"执行完成，AI 分析结果:\n{result.content}")


async def run_scheduler():
    """启动调度模式"""
    config = load_config()
    setup_ssl(config)
    context = build_context(config)
    scheduler = build_scheduler(context, config)

    scheduler.start()

    logger.info("盯盘侠已启动，等待调度触发...")
    logger.info(f"监控列表: {[s.name for s in config.watchlist]}")

    # 保持运行
    stop_event = asyncio.Event()

    def handle_signal():
        logger.info("收到退出信号，正在关闭...")
        stop_event.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, handle_signal)

    await stop_event.wait()
    scheduler.shutdown()


def main():
    parser = argparse.ArgumentParser(description="盯盘侠 / PanWatch - 你的 AI 盯盘搭子")
    parser.add_argument(
        "--run-now",
        metavar="AGENT",
        help="立即执行指定 Agent（如: daily_report）",
    )
    args = parser.parse_args()

    if args.run_now:
        asyncio.run(run_now(args.run_now))
    else:
        asyncio.run(run_scheduler())


if __name__ == "__main__":
    main()
