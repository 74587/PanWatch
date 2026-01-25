# 盯盘侠 / PanWatch - 产品需求文档

> 你的 AI 盯盘搭子

## 产品定位

面向个人投资者的 AI 股票监控助手，通过整合多数据源 + LLM 分析，提供个性化的盘中监控和盘后日报服务。

**核心价值**：帮用户省去手动盯盘和信息收集的时间，用 AI 做初步分析和信息聚合，用户做最终决策。

**市场支持**：
- Phase 1：A 股 + H 股
- 预留美股扩展接口（交易时段、数据源、汇率等差异抽象）

---

## 系统架构：Agent 插件化

### 设计理念

将盘中监控、盘后分析、新闻速递等功能视为独立的 **Agent 插件**。每个 Agent 是一个自包含的单元，拥有自己的数据采集、AI 分析、通知逻辑。系统提供统一的调度和管理能力。

### Agent 抽象协议

每个 Agent 遵循统一接口：

```python
class BaseAgent(ABC):
    name: str                    # 唯一标识（如 "daily_report"）
    display_name: str            # 显示名称（如 "盘后日报"）
    description: str             # 功能描述
    schedule_type: str           # 调度类型：cron / interval / event
    schedule_config: dict        # 调度参数

    @abstractmethod
    async def collect(self, context: AgentContext) -> dict:
        """采集数据：从数据源获取该 Agent 需要的信息"""

    @abstractmethod
    async def analyze(self, data: dict) -> AnalysisResult:
        """AI 分析：调用 LLM 处理数据"""

    @abstractmethod
    async def should_notify(self, result: AnalysisResult) -> bool:
        """通知决策：判断是否需要推送"""

    async def run(self, context: AgentContext):
        """标准执行流程（通常不需要重写）"""
        data = await self.collect(context)
        result = await self.analyze(data)
        if await self.should_notify(result):
            await context.notify(result)
        await context.save_history(result)
```

### 内置 Agent 清单

| Agent | 调度方式 | 数据源 | 输出 | 优先级 |
|---|---|---|---|---|
| daily_report（盘后日报） | cron: 15:30 | 行情 + 新闻 | 完整日报 | Phase 1 |
| intraday_monitor（盘中监控） | interval: 可配置 | 实时行情 | 异动简报 | Phase 4 |
| news_digest（新闻速递） | interval: 1h | 财联社/公告 | 相关新闻摘要 | Phase 3 |
| chart_analyst（技术面分析） | cron: 15:30 | K 线截图 | 图表分析 | Phase 3 |
| morning_brief（开盘前瞻） | cron: 9:00 | 隔夜外盘 + 新闻 | 今日关注点 | Phase 5 |

### Agent 管理能力（管理后台）

- **启用 / 禁用**：每个 Agent 独立开关
- **独立 AI 配置**：不同 Agent 可用不同模型（简单任务用便宜模型）
- **独立调度配置**：修改运行时间和频率
- **独立通知配置**：不同 Agent 推送到不同渠道
- **运行状态**：查看每个 Agent 的最近运行时间、成功/失败
- **手动触发**：在后台手动运行某个 Agent

### 扩展新 Agent

开发者只需：
1. 创建一个新文件 `agents/my_agent.py`
2. 继承 `BaseAgent`，实现 `collect` / `analyze` / `should_notify`
3. 在 Agent 注册表中注册
4. 管理后台自动识别并展示

不需要修改调度器、通知层、后台代码。

### Agent 之间的关系

- **互相独立**：每个 Agent 独立运行，不依赖其他 Agent 的输出
- **共享基础设施**：共用数据源层、AI 客户端、通知渠道
- **无通信**：不搞 Agent 之间的消息传递或协作（不需要，增加复杂度）

---

## 核心功能模块

### 1. 监控管理（高优先级）

用户可以配置"盯什么"和"怎么盯"。

#### 1.1 自选股管理

- 添加 / 删除 / 编辑自选股
- 每只股票可单独配置监控策略
- 支持录入持仓信息（成本价、持仓数量）

#### 1.2 监控模式配置

每只股票可独立设置：

| 配置项 | 选项 | 说明 |
|---|---|---|
| 监控类型 | 盘中 / 盘后日报 / 两者都要 | 核心配置 |
| 盘中间隔 | 15min / 30min / 60min / 自定义 | 盘中分析频率 |
| 通知条件 | 每次都通知 / 仅异动通知 | 防骚扰 |
| 异动阈值 | 涨跌幅 % / 成交量倍数 | 触发主动通知的条件 |

#### 1.3 全局配置

- 交易时段设置（默认 9:30-11:30, 13:00-15:00）
- 日报推送时间（默认 15:30）
- 通知渠道选择
- AI 模型配置（endpoint / model / api_key）

### 2. 数据源管理（高优先级）

#### 2.1 内置数据源

- **行情数据**：akshare（免费、实时性一般）
- **新闻资讯**：财联社、东方财富
- **基本面**：财务数据、公告

#### 2.2 截图数据源

- 配置截图 URL 模板（如同花顺/东方财富 K 线页面）
- 设置截图区域 / 分辨率
- 定时截图 or 按需截图

#### 2.3 数据源扩展（管理后台配置）

- 支持添加自定义数据源
- 配置采集频率
- 启用 / 禁用单个数据源

### 3. AI 分析（核心能力）

#### 3.1 盘后日报

触发时机：每日收盘后（15:30 默认）

内容包括：
```
📊 大盘概览
- 上证 / 深证 / 创业板涨跌幅
- 成交量对比
- 北向资金

📋 自选股速览
- 今日涨跌幅 + 成交量
- 与大盘对比

📰 要闻摘要
- 与持仓相关的 3-5 条新闻
- AI 点评影响

📈 技术面（如有截图）
- K 线形态描述
- 支撑位 / 压力位参考

💡 观点（仅供参考）
- 明日关注点
- 持仓建议方向
```

#### 3.2 盘中简报

触发时机：按用户配置的间隔 / 异动触发

内容包括：
```
⚡ 异动提醒
- 哪只股票触发了什么条件
- 当前价格 / 涨跌幅

📊 当前状态
- 自选股实时行情摘要

💡 简评（一两句话）
```

#### 3.3 分析配置

- 可调节分析风格：保守 / 中性 / 激进
- 可自定义分析重点：技术面为主 / 基本面为主 / 综合
- Prompt 模板可编辑（高级用户）

### 4. 通知推送

#### 4.1 渠道支持

优先级排序：
1. **Telegram Bot**（首选，免费、API 友好）
2. **Bark**（iOS 用户简单推送）
3. **钉钉机器人**
4. **邮件**
5. 其他（通过 apprise 库扩展）

#### 4.2 通知控制

- 免打扰时段设置
- 同一股票短时间内不重复通知（节流）
- 通知级别：日常 / 重要 / 紧急
- 紧急通知不受免打扰限制

### 5. 管理后台（高优先级）

#### 5.1 核心页面

```
首页（Dashboard）
├── 今日自选股涨跌概览
├── 最新一条日报摘要
└── 系统状态（定时任务运行状态、最近通知记录）

自选股管理
├── 列表：股票代码 / 名称 / 持仓 / 监控策略
├── 添加 / 编辑 / 删除
└── 批量导入

监控配置
├── 全局设置
├── 单股设置
└── 数据源管理

历史记录
├── 日报历史
├── 盘中通知历史
└── 按日期 / 股票筛选

AI 设置
├── 模型配置（endpoint / key / model）
├── Prompt 模板管理
└── 分析风格设置

系统设置
├── 通知渠道配置
├── 定时任务状态
└── 日志查看
```

#### 5.2 技术选型

- 后端：FastAPI
- 前端：Vue 3 + Element Plus（或 React，待定）
- 数据库：SQLite（初期）→ PostgreSQL（后期可选）

---

## 项目目录结构

```
panwatch/
├── docs/                        # 文档
├── src/
│   ├── agents/                  # Agent 插件目录
│   │   ├── base.py              # BaseAgent 抽象类 + AgentContext
│   │   ├── registry.py          # Agent 注册表（自动发现/手动注册）
│   │   ├── daily_report.py      # 盘后日报 Agent
│   │   ├── intraday_monitor.py  # 盘中监控 Agent
│   │   ├── news_digest.py       # 新闻速递 Agent
│   │   ├── chart_analyst.py     # 技术面截图 Agent
│   │   └── morning_brief.py     # 开盘前瞻 Agent
│   ├── core/                    # 共享基础设施
│   │   ├── ai_client.py         # OpenAI 协议客户端
│   │   ├── data_source.py       # 数据源管理
│   │   ├── notifier.py          # 通知抽象层
│   │   └── scheduler.py         # 调度器（加载 Agent、管理生命周期）
│   ├── collectors/              # 数据采集器
│   │   ├── akshare_collector.py # 行情数据
│   │   ├── news_collector.py    # 新闻采集
│   │   └── screenshot.py        # 浏览器截图
│   ├── web/                     # 管理后台
│   │   ├── api/                 # FastAPI 路由
│   │   └── frontend/            # 前端
│   ├── models/                  # 数据模型 / ORM
│   └── config.py                # 配置管理
├── data/                        # SQLite 数据库 + 本地缓存
├── prompts/                     # Prompt 模板（独立目录，方便迭代）
├── tests/
├── .env.example
├── requirements.txt
└── main.py                      # 入口
```

## 开发优先级

```
Phase 1：核心链路 + 第一个 Agent
    ├── BaseAgent 抽象类 + AgentContext
    ├── AI 客户端（OpenAI 协议）
    ├── 通知层（apprise 或 Telegram）
    ├── 数据采集（akshare 行情）
    ├── 实现 daily_report Agent（盘后日报）
    ├── 简单调度器（APScheduler）
    └── 配置文件管理自选股（临时方案）

Phase 2：管理后台 v1
    ├── FastAPI 后端 API
    ├── 前端页面：自选股管理 + Agent 管理面板
    ├── Agent 启用/禁用/配置
    ├── 数据库持久化（SQLite）
    └── 用后台替代配置文件

Phase 3：更多 Agent + 多数据源
    ├── news_digest Agent（新闻速递）
    ├── chart_analyst Agent（截图分析）
    ├── Playwright 截图采集器
    ├── 后台管理数据源配置
    └── 多模态分析能力

Phase 4：盘中监控 Agent
    ├── intraday_monitor Agent
    ├── 异动检测逻辑
    ├── 盘中调度（interval 模式）
    └── 通知节流

Phase 5：完善
    ├── morning_brief Agent（开盘前瞻）
    ├── 更多通知渠道
    ├── 历史记录 + Dashboard
    ├── Prompt 调优
    └── 自定义 Agent 开发文档
```

---

## 非功能需求

- **部署**：支持本地运行（个人电脑 / 家庭服务器）
- **性能**：日报生成 < 1 分钟，盘中分析 < 30 秒
- **成本**：优先使用免费 API 额度，付费模型可选
- **安全**：API Key 等敏感信息不硬编码，使用 .env 管理
- **可靠性**：任务失败自动重试，通知失败有日志记录
