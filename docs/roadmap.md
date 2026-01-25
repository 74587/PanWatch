# 盯盘侠 / PanWatch - 开发路线图

> 你的 AI 盯盘搭子

## 分阶段开发计划

### Phase 1：核心链路 + 第一个 Agent

目标：搭建 Agent 基础框架，实现"盘后日报 Agent"，跑通 数据采集 → AI 分析 → 通知 的完整链路。

学习点：
- Python 项目结构 + 异步编程
- 调用 OpenAI 协议 API
- 抽象类设计（Agent / Notifier）
- 基础数据采集

任务：
1. 项目初始化（pyproject.toml / requirements.txt / .env）
2. 实现 BaseAgent 抽象类 + AgentContext
3. 实现 AI 客户端（OpenAI 协议，支持任意 base_url）
4. 实现通知层（apprise 或 Telegram）
5. 实现 akshare 行情采集器
6. 实现 daily_report Agent（盘后日报）
7. 简单调度器（APScheduler，cron 模式）
8. 配置文件管理自选股（YAML，临时方案）
9. 跑起来！验证完整链路

### Phase 2：管理后台 v1

目标：用 Web 界面替代配置文件，管理自选股和 Agent。

学习点：
- FastAPI 后端开发
- 前端基础（Vue 3 / React）
- 数据库设计（SQLite + ORM）

任务：
1. 数据库模型设计（自选股、持仓、Agent 配置、运行记录）
2. FastAPI 后端 API（CRUD）
3. 前端页面：自选股管理
4. 前端页面：Agent 管理面板（启用/禁用/配置/手动触发）
5. 前端页面：AI 模型配置
6. 前端页面：通知渠道配置
7. 后台替代 YAML 配置文件

### Phase 3：更多 Agent + 多数据源

目标：扩展 Agent 阵容，引入非结构化数据源。

学习点：
- Playwright 浏览器自动化
- 多模态模型调用（图片输入）
- 爬虫 / 数据聚合

任务：
1. 新闻采集器（财联社 / 东方财富）
2. 实现 news_digest Agent（新闻速递）
3. Playwright 截图采集器（K 线图）
4. 实现 chart_analyst Agent（截图分析，多模态）
5. 后台：数据源管理页面
6. 每个 Agent 可独立配置 AI 模型

### Phase 4：盘中监控 Agent

目标：交易时段定时分析，异动时主动通知。

学习点：
- interval 调度模式
- 异动检测算法
- 通知频率控制

任务：
1. 实现 intraday_monitor Agent
2. 异动检测逻辑（涨跌幅、成交量突变）
3. 通知节流（同一股票短时间不重复通知）
4. 后台配置盘中间隔和异动阈值

### Phase 5：完善

任务：
1. 实现 morning_brief Agent（开盘前瞻）
2. 更多通知渠道接入
3. 历史记录查看页面
4. Dashboard 首页
5. Prompt 模板管理和调优
6. 编写"如何开发自定义 Agent"文档

---

## 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| Agent 框架 | 自研（BaseAgent） | 场景简单，不需要 LangChain 等重框架 |
| 数据采集 | akshare | 免费、A股数据全 |
| 浏览器自动化 | Playwright | 比 Selenium 更现代，支持 CDP |
| AI 调用 | openai SDK | 标准协议，换模型只改 base_url |
| 通知 | apprise（或自研抽象层） | 支持 50+ 渠道，省得自己写 |
| 定时调度 | APScheduler | 轻量，支持 cron + interval |
| 配置 | pydantic-settings | 类型安全，支持 .env |
| 数据存储 | SQLite（初期） | 零依赖，后期可换 PostgreSQL |
| 后端 | FastAPI | 异步、类型安全、自动文档 |
| 前端 | 待定（Vue 3 / React） | — |

---

## 开发原则

1. **每个 Phase 做完都要能实际跑起来** — 别堆一堆代码最后才联调
2. **先硬编码，再抽象** — Phase 1 不要过度设计，先让日报 Agent 能跑
3. **Agent 之间不通信** — 保持独立，共享基础设施但不共享状态
4. **Prompt 是核心竞争力** — 多迭代、多试，找到对你有用的输出格式
5. **AI 输出仅供参考** — 代码里加 disclaimer，别对着通知无脑操作
6. **新增 Agent 不改框架** — 如果加一个 Agent 要改调度器或通知层，说明抽象不对
