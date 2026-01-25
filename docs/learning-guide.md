# LLM / Agent 开发学习指南

## 为什么是 Python

Python 在 AI 领域的生态优势不是"稍微领先"，而是碾压级的：

1. **所有主流 LLM 厂商的 SDK 都是 Python 优先**（OpenAI、Anthropic、智谱、百度等）
2. **数据处理生态完整**（pandas、numpy、数据清洗一条龙）
3. **Agent 框架全部是 Python**（LangChain、CrewAI、AutoGen 等）
4. **社区资源最多** — 教程、开源项目、Stack Overflow 答案
5. **胶水语言特性** — 串联 API、数据库、爬虫、定时任务非常自然

Go/Rust/Java 在 LLM 应用层几乎没有成熟框架，选它们等于自己造轮子。

---

## 核心概念（先理解再动手）

### 1. LLM API 调用基础

最底层的能力，理解这些就能做大部分事情：

```python
from openai import OpenAI

client = OpenAI(base_url="...", api_key="...")

# 最基本的对话
response = client.chat.completions.create(
    model="glm-4",
    messages=[
        {"role": "system", "content": "你是一个股票分析师"},
        {"role": "user", "content": "分析一下今天大盘走势"}
    ]
)
```

关键概念：
- **Messages**：system / user / assistant 三种角色
- **Temperature**：控制输出随机性（分析场景建议 0.3-0.5）
- **Token**：计费和上下文长度的单位
- **Streaming**：流式输出，体验更好

### 2. Function Calling / Tool Use

Agent 的核心能力 — 让 LLM 调用外部工具：

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_price",
            "description": "获取股票当前价格",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "description": "股票代码"}
                }
            }
        }
    }
]

# LLM 会决定是否调用工具，以及传什么参数
response = client.chat.completions.create(
    model="glm-4",
    messages=messages,
    tools=tools
)
```

流程：用户提问 → LLM 决定调用哪个工具 → 你执行工具拿到结果 → 把结果喂回 LLM → LLM 生成最终回答

### 3. 多模态（Vision）

让 LLM 看图：

```python
response = client.chat.completions.create(
    model="glm-4v",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "分析这个K线图的走势"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
        ]
    }]
)
```

### 4. Prompt Engineering

不是玄学，是工程：
- **角色设定**：告诉模型它是谁、专长是什么
- **输出格式约束**：要求 JSON / Markdown / 固定结构
- **Few-shot**：给几个示例，让模型模仿
- **Chain of Thought**：让模型先分析再给结论

### 5. Agent 循环

Agent 的本质就是一个 while 循环：

```python
while not done:
    # 1. LLM 思考下一步该做什么
    response = llm.think(context)

    # 2. 如果 LLM 决定调用工具
    if response.has_tool_call:
        result = execute_tool(response.tool_call)
        context.append(result)

    # 3. 如果 LLM 认为任务完成
    else:
        done = True
        return response.content
```

### 6. 记忆 / 上下文管理

LLM 是无状态的，每次调用都是全新的。"记忆"需要你自己管理：
- **短期记忆**：对话历史（messages 列表）
- **长期记忆**：持久化存储 + 检索（向量数据库 / 关键词检索）

对于 PanWatch 场景，持仓信息和历史日报就是"记忆"。

---

## Python AI 生态工具全景

### LLM SDK（直接调用模型）

| 工具 | 用途 | 备注 |
|---|---|---|
| openai | OpenAI 协议标准 SDK | 兼容所有 OpenAI 协议的服务 |
| anthropic | Claude API | |
| zhipuai | 智谱 GLM | 有免费额度 |

**PanWatch 选择**：只用 `openai` SDK，通过 `base_url` 切换不同模型服务。

### Agent 框架

| 框架 | 特点 | 适合场景 |
|---|---|---|
| LangChain | 大而全，组件多 | 复杂 RAG、多步 Agent |
| LlamaIndex | 专注数据索引和检索 | 文档问答 |
| CrewAI | 多 Agent 协作 | 多角色协同任务 |
| AutoGen (微软) | 多 Agent 对话 | 研究性质 |
| Dify / Coze | 低代码平台 | 快速原型验证 |

**PanWatch 选择**：Phase 1-3 不用任何框架，直接用 openai SDK。理解原理后再考虑是否引入框架。理由：框架是锦上添花，不是必需品。你的场景不复杂，用框架反而增加学习成本和调试难度。

### 数据处理

| 工具 | 用途 |
|---|---|
| akshare | A股行情、财务数据、新闻 |
| tushare | A股数据（需要积分） |
| pandas | 数据清洗和分析 |
| playwright | 浏览器自动化、截图 |

### 通知推送

| 工具 | 用途 |
|---|---|
| python-telegram-bot | Telegram 消息推送 |
| bark | iOS 推送（极简） |
| apprise | 统一通知库（支持 50+ 平台） |

> **发现**：`apprise` 这个库本身就是一个通知抽象层，支持 Telegram / 钉钉 / Bark / Email / Slack 等 50+ 渠道。可以直接用它代替我们自己写抽象层。

### 定时调度

| 工具 | 用途 |
|---|---|
| APScheduler | Python 定时任务 |
| celery | 分布式任务队列（重，初期不需要） |

---

## 学习路径

```
第一步：Python 基础（如果还不熟）
  ├── 异步编程（async/await）
  ├── 类型提示（type hints）
  └── 包管理（pip / poetry / uv）

第二步：LLM API 调用（1-2 天上手）
  ├── 注册一个模型服务（智谱免费额度）
  ├── 用 openai SDK 发送对话请求
  ├── 理解 messages / temperature / token
  └── 试试不同的 system prompt 效果

第三步：Function Calling（核心！）
  ├── 定义 tools schema
  ├── 处理 LLM 返回的 tool_calls
  ├── 执行工具并把结果喂回
  └── 理解：这就是 Agent 的核心机制

第四步：构建 PanWatch Phase 1
  ├── 边做边学
  ├── 遇到问题再查
  └── 这个项目本身就是最好的学习材料

第五步：进阶（做完 Phase 1-3 后再看）
  ├── RAG（检索增强生成）
  ├── 向量数据库（Chroma / FAISS）
  ├── Agent 框架源码阅读
  └── 多 Agent 协作
```

---

## 推荐资源

- OpenAI 官方文档 Cookbook：https://cookbook.openai.com
- 智谱 AI 开放平台：https://open.bigmodel.cn（免费额度练手）
- akshare 文档：https://akshare.akfamily.xyz
- Playwright Python 文档：https://playwright.dev/python/

---

## 核心认知

1. **Agent ≠ 框架** — 理解原理后，100 行代码就能写一个 Agent
2. **Prompt 是核心** — 同样的架构，Prompt 好坏决定输出质量天差地别
3. **先跑通再优化** — 别在架构上纠结，先让它能用
4. **LLM 是不可靠的** — 永远做好兜底，不要信任模型的每一个输出
