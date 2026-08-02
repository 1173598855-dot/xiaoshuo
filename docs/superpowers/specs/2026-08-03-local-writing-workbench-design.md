# 本地小说创作工作台设计

日期：2026-08-03

状态：依据用户的自主执行授权直接采用，进入实现。

## 1. 背景与恢复结论

上一轮会话只完成了方案研究，没有创建代码、Git 仓库或项目文档。已恢复的需求是：构建一个写小说的工具，并能接入热门模型 API。上一轮审查还明确了三个不可退让的领域约束：生成必须先预览后采纳；每次生成必须冻结上下文 revision；AI 记忆不能成为独立事实源。

因此本轮不是续写已有代码，而是把已完成的研究转成第一个可运行、可测试的产品闭环。

## 2. 目标与成功标准

首个增量交付一个本地单用户工作台。用户可以编辑章节、配置任一受支持模型、生成候选文本，并在正文 revision 未变化时采纳候选。

完成标准：

- 新环境运行后自动创建一个项目和空章节；
- 章节保存后刷新页面内容仍存在；
- 旧 revision 的保存请求返回 `409`，不覆盖新正文；
- 生成完成前和候选采纳前正文保持不变；
- 同一生成任务最多采纳一次；
- API Key 不进入 SQLite、生成记录、错误日志或响应；
- 单元测试、类型检查、构建和浏览器主流程全部通过。

## 3. 方案比较

### 方案 A：本地 Web 单体，采用

React/Vite 提供编辑体验，Node 服务监听本机地址并负责 SQLite 与模型 SDK。浏览器只在 `sessionStorage` 保存密钥，每次生成临时传给本地服务。该方案开发和测试成本最低，同时保留未来用 Tauri 包装的路径。

### 方案 B：立即采用 Tauri 桌面应用

优点是原生窗口、系统密钥链和文件能力更自然；代价是 Rust/Windows SDK 构建链、跨平台打包和端到端测试都会提前扩大首批范围。等本地 Web 闭环稳定后再封装更合适。

### 方案 C：纯浏览器 PWA

部署最简单，但会把 API Key 和厂商调用放进浏览器，受到 CORS、请求签名和日志暴露限制，也无法可靠地做本地 SQLite 与无损归档，因此不采用。

## 4. 系统边界

```text
React workbench
  |-- workspace API --------> Hono routes ----> SQLite repositories
  |-- generation request ---> generation service ---> provider adapter
  |                                                   |-- OpenAI SDK
  |                                                   |-- Anthropic SDK
  |                                                   |-- Google GenAI SDK
  |                                                   `-- OpenAI-compatible SDK
  `-- session-only key
```

应用采用单仓库、单 npm 包，避免首版引入工作区编排。源码按职责分为：

- `src/client`: 页面、交互和本地会话配置；
- `src/server`: HTTP、SQLite、生成事务与厂商适配；
- `src/shared`: Zod 契约、枚举和跨端 DTO；
- `tests`: 服务、契约和领域行为测试；
- `e2e`: 浏览器主流程。

## 5. 数据模型

### Project

`id`, `title`, `description`, `createdAt`, `updatedAt`。

### Chapter

`id`, `projectId`, `title`, `content`, `status`, `position`, `revision`, `createdAt`, `updatedAt`。`status` 首版支持 `draft`, `final`, `published`, `locked`。稳定 UUID 是引用键，标题和章节号不是主键。

### ChapterRevision

每次正文变化前保存完整快照：`id`, `chapterId`, `revision`, `title`, `content`, `source`, `createdAt`。首版接受完整快照的空间成本，以换取恢复简单和逻辑明确。

### Generation

`id`, `chapterId`, `baseRevision`, `provider`, `model`, `operation`, `instruction`, `contextJson`, `candidate`, `status`, `usageJson`, `createdAt`, `acceptedAt`。`status` 为 `pending`, `completed`, `accepted`, `discarded`, `failed`。

生成记录不得保存 API Key。`contextJson` 保存生成时冻结的章节 ID、revision、标题和正文哈希，后续会扩展到正典、摘要和大纲 revision。

## 6. API 与状态流

- `GET /api/health`: 进程和数据库健康检查；
- `GET /api/workspace`: 返回当前项目、章节列表和选中章节正文；
- `POST /api/projects`: 创建项目；
- `POST /api/projects/:projectId/chapters`: 创建章节；
- `PATCH /api/chapters/:chapterId`: 以 `expectedRevision` 更新标题、正文或状态；
- `GET /api/providers`: 返回适配器与预设，不含凭据；
- `POST /api/generations`: 冻结章节 revision，调用模型并保存候选；
- `POST /api/generations/:generationId/accept`: revision 一致时原子追加候选；
- `POST /api/generations/:generationId/discard`: 丢弃候选，不改正文。

生成状态流：

```text
pending -> completed -> accepted
                    `-> discarded
pending -> failed
```

采纳事务同时验证：生成状态为 `completed`、章节当前 revision 等于 `baseRevision`、候选尚未采纳。成功后写旧章节快照、更新正文和 revision，再把生成标记为 `accepted`。任一条件失败都整体回滚。

## 7. 模型适配

统一接口只抽象产品真正需要的交集：文本生成、取消、用量和归一化错误。能力差异保留在 adapter 元数据中，不把思考参数、工具调用或结构化输出硬翻译为所有厂商共有。

首批适配：

- OpenAI 原生 Responses API，预设包含 `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`；
- Anthropic 原生 Messages API，默认建议 `claude-opus-4-8`；
- Google Gemini 官方 SDK；
- OpenAI-compatible 自定义 `baseUrl`，覆盖 DeepSeek、通义兼容端点、硅基流动、OpenRouter 等；
- Ollama 作为 OpenAI-compatible 本地预设。

模型 ID 始终允许手工输入，预设只用于快速开始。适配器对认证、限流、连接、超时和上游请求错误做稳定分类，响应不得回显凭据或完整上游请求头。

## 8. 提示与上下文

首版提示由稳定系统提示、冻结章节上下文和用户指令组成。系统提示要求只返回可直接进入小说正文的候选，不输出分析、标题或 Markdown 围栏。用户可选择 `continue`, `rewrite`, `polish`，首个 UI 重点支持续写。

为了避免超长章节无声截断，服务在超过当前安全字符预算时返回明确的 `CONTEXT_TOO_LARGE`，后续增量再接入 token counting、章节摘要和检索记忆。

## 9. 界面设计

受众是高频写作的中文作者，页面唯一工作是让作者在章节、正文和 AI 候选之间快速移动。界面采用安静、密集的三栏工作台，不做 landing page，也不堆叠装饰卡片。

色彩 token：

- `ink #20251F`: 正文与主文字；
- `canvas #F4F6F3`: 应用背景；
- `paper #FFFFFF`: 编辑纸面；
- `pine #2E6A4F`: 主操作与保存状态；
- `coral #C9574C`: 冲突和危险状态；
- `violet #6C5A8D`: AI 候选与模型状态。

字体角色：正文使用 `STSong`, `Songti SC`, `Noto Serif SC`；界面使用 `Microsoft YaHei`, `Noto Sans SC`；计数和 revision 使用 `Cascadia Mono`。不通过 viewport width 缩放字号。

布局：

```text
+----------------+--------------------------------+--------------------+
| 项目/章节脊线   | 工具栏                         | 模型与生成          |
|                +--------------------------------+                    |
| 状态点 章节名   |                                | 操作/指令/模型      |
| 状态点 章节名   |        正文编辑纸面             |                    |
| + 新建章节      |                                | 候选差异与采纳      |
+----------------+--------------------------------+--------------------+
```

记忆点是章节列表中的“书脊进度线”：状态点沿一条细线排列，既编码章节顺序与发布状态，也让界面具有小说项目特征。其他区域保持克制。窄屏时章节栏和 AI 栏变为抽屉，中央编辑区保持主视图。

## 10. 异常与恢复

- 400：输入或 provider 配置无效，界面定位到具体字段；
- 401/403：显示认证失败，不保留密钥；
- 409：正文 revision 冲突，保留本地草稿并提示重新加载；
- 429/5xx/网络错误：候选状态为 `failed`，正文不变，可重试；
- 页面关闭：客户端在内容变更后 800ms 自动保存；未完成请求使用 AbortController 取消；
- 数据库写入：使用事务和 WAL，服务只监听 `127.0.0.1`。

## 11. 测试策略

- 契约测试验证输入拒绝和错误响应；
- repository 测试使用内存 SQLite，覆盖 revision 冲突和事务回滚；
- provider 测试注入假 SDK/transport，不访问真实模型；
- route 测试通过 Hono `app.request` 覆盖完整状态流；
- React 测试覆盖自动保存、冲突保留和候选采纳；
- Playwright 覆盖桌面和移动视口，检查布局、键盘焦点和实际交互；
- 最终执行 lint、typecheck、unit、build 和 e2e。

## 12. 明确延后

正典/角色时间线、派生记忆、冲突检测、TXT/Markdown 导入导出、无损项目归档、命名检查点、流式增量渲染和 Tauri 打包属于后续增量。当前数据结构保留稳定 ID、revision 和 generation context，避免这些能力加入时推翻首个闭环。
