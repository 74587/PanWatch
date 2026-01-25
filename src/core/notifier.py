import logging
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"


class BaseNotifier(ABC):
    """通知抽象基类"""

    name: str

    @abstractmethod
    async def send_text(self, title: str, content: str) -> bool:
        """发送文本通知"""
        ...

    @abstractmethod
    async def send_image(self, title: str, image_path: str, caption: str = "") -> bool:
        """发送图片通知"""
        ...


class TelegramNotifier(BaseNotifier):
    """Telegram 通知实现（直接调用 Bot API）"""

    name = "telegram"

    def __init__(self, bot_token: str, chat_id: str, proxy: str = "", ca_cert: str = ""):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.proxy = proxy or None
        self.ca_cert = ca_cert or True  # True = 默认证书验证

    def _get_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(proxy=self.proxy, verify=self.ca_cert)

    async def send_text(self, title: str, content: str) -> bool:
        url = f"{TELEGRAM_API}/bot{self.bot_token}/sendMessage"
        text = f"*{title}*\n\n{content}" if title else content

        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "Markdown",
        }

        try:
            async with self._get_client() as client:
                resp = await client.post(url, json=payload, timeout=30)
                if resp.status_code == 200:
                    logger.info(f"Telegram 通知发送成功: {title}")
                    return True
                else:
                    logger.error(f"Telegram 通知发送失败: {resp.status_code} {resp.text}")
                    return False
        except Exception as e:
            logger.error(f"Telegram 通知异常: {e}")
            return False

    async def send_image(self, title: str, image_path: str, caption: str = "") -> bool:
        url = f"{TELEGRAM_API}/bot{self.bot_token}/sendPhoto"

        try:
            async with self._get_client() as client:
                with open(image_path, "rb") as f:
                    files = {"photo": f}
                    data = {"chat_id": self.chat_id, "caption": caption or title}
                    resp = await client.post(url, data=data, files=files, timeout=30)
                    if resp.status_code == 200:
                        logger.info(f"Telegram 图片发送成功: {title}")
                        return True
                    else:
                        logger.error(f"Telegram 图片发送失败: {resp.status_code} {resp.text}")
                        return False
        except Exception as e:
            logger.error(f"Telegram 图片发送异常: {e}")
            return False


class NotifierManager:
    """通知管理器，统一管理多个通知渠道"""

    def __init__(self):
        self.notifiers: list[BaseNotifier] = []

    def add(self, notifier: BaseNotifier):
        self.notifiers.append(notifier)
        logger.info(f"注册通知渠道: {notifier.name}")

    async def notify(self, title: str, content: str, images: list[str] | None = None):
        """向所有已注册渠道发送通知"""
        if not self.notifiers:
            logger.warning("没有可用的通知渠道")
            return

        for notifier in self.notifiers:
            await notifier.send_text(title, content)
            if images:
                for img in images:
                    await notifier.send_image(title, img)
