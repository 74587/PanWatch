# 盯盘侠 / PanWatch - MVP 实施计划

> Phase 1：核心链路 + 第一个 Agent（盘后日报）

## MVP 目标

用户配置好自选股后，每天收盘系统自动采集 A 股 / H 股行情数据，通过 AI 生成日报，推送到 Telegram。

## 市场支持

| 市场 | MVP 阶段 | 交易时段 | 数据源 |
|---|---|---|---|
| A 股 | 支持 | 9:30-11:30, 13:00-15:00 | akshare |
| H 股 | 支持 | 9:30-12:00, 13:00-16:00 | akshare |
| 美股 | 预留接口，不实现 | 21:30-04:00 (北京时间) | 待定 |

### 市场抽象设计

```python
class Market:
    """市场定义"""
    code: str              # "CN" / "HK" / "US"
    name: str              # "A股" / "港股" / "美股"
    timezone: str          # "Asia/Shanghai" / "Asia/Hong_Kong" / "US/Eastern"
    trading_sessions: list # 交易时段列表
    symbol_pattern: str    # 股票代码格式校验

# MVP 实现 CN + HK，US 定义好接口但不实现采集器
```

---

## 详细实施步骤

### Step 1：项目初始化

**目标**：搭好项目骨架，能跑起来。

```
panwatch/
├── src/
│   ├── __init__.py
│   ├── agents/
│   │   ├── __init__.py
│   │   └── base.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── ai_client.py
│   │   ├── notifier.py
│   │   └── scheduler.py
│   ├── collectors/
│   │   ├── __init__.py
│   │   └── akshare_collector.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── market.py
│   └── config.py
├── prompts/
│   └── daily_report.txt
├── data/
├── tests/
├── .env.example
├── .gitignore
├── requirements.txt
└── main.py
```

**依赖清单**（requirements.txt）：
```
openai>=1.0.0
akshare>=1.10.0
apscheduler>=3.10.0
apprise>=1.6.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
pyyaml>=6.0
aiohttp>=3.9.0
```

**配置结构**（.env.example）：
```env
# AI 配置
AI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
AI_API_KEY=your_key_here
AI_MODEL=glm-4

# 通知配置
NOTIFY_TELEGRAM_BOT_TOKEN=your_bot_token
NOTIFY_TELEGRAM_CHAT_ID=your_chat_id

# 调度配置
DAILY_REPORT_CRON=15 30 * * 1-5
```

**自选股配置**（config/watchlist.yaml，临时方案）：
```yaml
markets:
  - code: CN
    stocks:
      - symbol: "600519"
        name: "贵州茅台"
        cost_price: 1800.00    # 可选，持仓成本
        quantity: 100          # 可选，持仓数量
      - symbol: "000001"
        name: "平安银行"
  - code: HK
    stocks:
      - symbol: "00700"
        name: "腾讯控股"
```

---

### Step 2：市场模型 + 配置管理

**文件**：`src/models/market.py`

实现内容：
- Market 枚举（CN / HK / US）
- 每个市场的交易时段定义
- 股票代码校验规则
- `is_trading_time()` 判断当前是否在交易时段
- 时区处理

**文件**：`src/config.py`

实现内容：
- 用 pydantic-settings 管理 .env 配置
- 加载 watchlist.yaml
- 配置校验

---

### Step 3：AI 客户端

**文件**：`src/core/ai_client.py`

实现内容：
- 封装 openai SDK
- 支持任意 OpenAI 协议兼容的 endpoint（base_url 可配置）
- 支持文本对话（chat completion）
- 预留多模态接口（images 参数，MVP 阶段不用）
- 错误处理 + 重试
- Token 用量记录（方便后续看成本）

核心接口：
```python
class AIClient:
    async def chat(self, system_prompt: str, user_content: str,
                   images: list[str] = None, temperature: float = 0.4) -> str:
        """调用 LLM，返回文本结果"""

    async def chat_with_tools(self, messages: list, tools: list) -> dict:
        """带工具调用的对话（Phase 1 不用，预留）"""
```

---

### Step 4：通知层

**文件**：`src/core/notifier.py`

实现内容：
- 通知抽象基类
- Telegram 实现（通过 apprise 或直接用 python-telegram-bot）
- 支持发送纯文本 + Markdown 格式
- 支持发送图片（为截图分析预留）
- 发送失败日志记录

核心接口：
```python
class BaseNotifier(ABC):
    @abstractmethod
    async def send_text(self, title: str, content: str) -> bool: ...

    @abstractmethod
    async def send_image(self, title: str, image_path: str, caption: str = "") -> bool: ...

class TelegramNotifier(BaseNotifier): ...

class NotifierManager:
    """管理多个通知渠道，统一发送"""
    notifiers: list[BaseNotifier]

    async def notify(self, title: str, content: str, images: list[str] = None):
        """向所有已启用渠道发送通知"""
```

---

### Step 5：数据采集器

**文件**：`src/collectors/akshare_collector.py`

实现内容：
- A 股行情数据（个股日K、实时行情）
- A 股大盘指数（上证、深证、创业板）
- H 股行情数据
- 数据标准化输出格式（不同市场返回统一结构）

核心接口：
```python
class MarketCollector(ABC):
    market: Market

    @abstractmethod
    async def get_index_data(self) -> list[IndexData]:
        """获取大盘指数"""

    @abstractmethod
    async def get_stock_data(self, symbols: list[str]) -> list[StockData]:
        """获取个股行情"""

class AkshareCollector(MarketCollector):
    """支持 CN + HK"""

# 标准化数据结构
@dataclass
class StockData:
    symbol: str
    name: str
    market: str          # CN / HK / US
    current_price: float
    change_pct: float    # 涨跌幅 %
    volume: float        # 成交量
    turnover: float      # 成交额
    open_price: float
    high_price: float
    low_price: float
    prev_close: float
    timestamp: datetime
```

---

### Step 6：BaseAgent 框架

**文件**：`src/agents/base.py`

实现内容：
- BaseAgent 抽象类
- AgentContext（运行时上下文：AI 客户端、通知器、配置等）
- Agent 运行结果模型（AnalysisResult）
- 标准 run() 流程

```python
@dataclass
class AgentContext:
    ai_client: AIClient
    notifier: NotifierManager
    config: AppConfig
    watchlist: list[StockConfig]

@dataclass
class AnalysisResult:
    agent_name: str
    title: str
    content: str          # AI 生成的分析内容
    raw_data: dict        # 原始数据（存档用）
    images: list[str]     # 附图路径
    timestamp: datetime
    should_notify: bool   # 是否需要推送

class BaseAgent(ABC):
    name: str
    display_name: str
    description: str

    @abstractmethod
    async def collect(self, context: AgentContext) -> dict:
        """采集数据"""

    @abstractmethod
    def build_prompt(self, data: dict) -> tuple[str, str]:
        """构建 prompt，返回 (system_prompt, user_content)"""

    async def analyze(self, context: AgentContext, data: dict) -> AnalysisResult:
        """调用 AI 分析（通常不需要重写）"""
        system_prompt, user_content = self.build_prompt(data)
        content = await context.ai_client.chat(system_prompt, user_content)
        return AnalysisResult(...)

    async def should_notify(self, result: AnalysisResult) -> bool:
        """是否需要通知（子类可重写，默认 True）"""
        return True

    async def run(self, context: AgentContext) -> AnalysisResult:
        """标准执行流程"""
        data = await self.collect(context)
        result = await self.analyze(context, data)
        if await self.should_notify(result):
            await context.notifier.notify(result.title, result.content, result.images)
        return result
```

---

### Step 7：盘后日报 Agent

**文件**：`src/agents/daily_report.py`
**Prompt 文件**：`prompts/daily_report.txt`

实现内容：
- 继承 BaseAgent
- collect()：获取大盘指数 + 自选股行情
- build_prompt()：将数据格式化为 Prompt
- 输出格式：Markdown 格式日报

**Prompt 设计思路**：
```
角色：你是一个专业的股票分析师助手
输入：今日大盘数据 + 自选股行情 + 用户持仓信息
要求：
  1. 大盘概览（涨跌、成交量、风格特征）
  2. 自选股逐只分析（当日表现、与大盘对比）
  3. 持仓盈亏提示（如有持仓信息）
  4. 明日关注点
  5. 控制在 500 字以内
  6. 末尾加 disclaimer
输出格式：Markdown
```

---

### Step 8：调度器

**文件**：`src/core/scheduler.py`

实现内容：
- 用 APScheduler 管理定时任务
- 注册 Agent + 对应的调度规则
- 支持 cron 表达式
- 交易日判断（跳过周末和节假日）
- 手动触发能力（命令行参数）

```python
class AgentScheduler:
    def register(self, agent: BaseAgent, cron: str): ...
    def start(self): ...
    def trigger_now(self, agent_name: str): ...  # 手动触发
```

---

### Step 9：入口 + 联调

**文件**：`main.py`

实现内容：
- 加载配置
- 初始化各组件（AI 客户端、通知器、采集器）
- 构建 AgentContext
- 注册 daily_report Agent 到调度器
- 启动调度器
- 支持命令行参数：`--run-now` 立即执行一次（调试用）

```bash
# 正常运行（等待调度）
python main.py

# 立即执行一次日报（调试）
python main.py --run-now daily_report
```

---

## 验收标准

MVP 完成的标志：

- [ ] 运行 `python main.py --run-now daily_report`
- [ ] 系统自动从 akshare 获取 A 股 / H 股行情
- [ ] 调用配置的 AI 模型生成日报
- [ ] 日报推送到 Telegram
- [ ] 日报内容包含：大盘 + 自选股 + 简评
- [ ] 持仓盈亏正确计算（如有配置持仓）
- [ ] 定时任务能在工作日 15:30 自动触发
- [ ] 周末和节假日不触发

---

## 开发顺序建议

```
Step 1 项目初始化
  ↓
Step 2 市场模型 + 配置（先有数据结构）
  ↓
Step 3 AI 客户端（独立验证能调通）
  ↓
Step 4 通知层（独立验证能发消息）
  ↓
Step 5 数据采集器（独立验证能拿到数据）
  ↓
Step 6 BaseAgent 框架（把上面的串起来）
  ↓
Step 7 盘后日报 Agent（第一个具体实现）
  ↓
Step 8 调度器（加上定时能力）
  ↓
Step 9 入口 + 联调（跑通完整链路）
```

每个 Step 完成后都可以独立测试，不依赖后续步骤。

---

## 风险和注意事项

1. **akshare 接口稳定性** — 免费接口可能限流或变动，做好异常处理
2. **H 股数据** — akshare 对港股支持可能不如 A 股全面，需实测
3. **Telegram 网络** — 国内访问 Telegram API 可能需要代理，配置里预留 proxy 选项
4. **节假日判断** — A 股和 H 股休市日不完全一致，需要分别处理
5. **AI 输出格式** — LLM 不一定严格按照 Prompt 要求输出，做好格式兜底
