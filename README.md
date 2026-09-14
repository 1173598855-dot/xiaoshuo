# 小奕小说生成工具

小奕现在是一个本地优先的 AI 长篇小说生产工具：你只需要输入一句故事想法，AI 会先给出 3 套整本方向，再自动完成基础设定、卷章规划、逐章写作、审核修复和正文交付。模型配置支持一键测试连接、兼容端点拉取模型列表和自动选模型；配置好后可以直接“一键开写”。

## 使用流程

```text
一句想法 → 一键开写 / 3 套整本方向 → 选择方向 → 记忆选择 → 自动规划 → 逐章生产 → 审核修复 → 候选编辑/Diff → 记忆审阅 → 正式正文
```

- 角色、世界观、伏笔和时间线由 AI 自动生成并作为后台上下文维护，不要求手填角色卡；
- 每一章先保存为候选，审核通过后才通过原子 accept 事务进入正式正文；
- 生产任务会保存检查点，关闭应用后可以继续；
- 首页提供悬疑短篇、都市连载和东方幻想预设，也可以只输入自己的想法；
- 生产室支持暂停、继续、停止、失败阶段重试和重新选择当前模型；应用启动时会自动恢复排队中/运行中的任务；
- 生产室支持对当前章节发起 AI 重写，重写结果仍然是隔离候选，必须审核并采纳后才会进入正文；
- 生产室提供独立的“长篇记忆中心”：自动维护世界规则、人物状态、事实、时间线、伏笔和文风约束，按当前章节筛选后注入 draft/review/repair；
- 记忆中心支持“自动推荐”或“仅发送选中”：作者可逐条勾选本地记忆，只有选中的条目会进入当前生产任务的 Provider prompt，空选择表示不发送记忆；这项选择冻结在生产 run 和候选上，不改变本地记忆账本；
- 章节审核会逐条展示 AI 提议的记忆新增、更新和解决，作者确认后才会与正文在同一事务中落盘；全部忽略也可以继续生产；
- 候选正文在 accept 前可以手动编辑；编辑采用 candidate text revision 乐观锁，保存后会清空旧审核/记忆提议并重新审核，Diff 保留初始候选与当前候选的逐行变化；
- 记忆中心会显示每条注入记忆的选择原因，支持查看完整 revision 历史并把条目回滚为新的手动修正 revision；
- 记忆条目带独立 revision 和历史快照，可锁定/解锁或进行 JSON 高级修正；锁定内容不会被 AI 自动覆盖，手动修改遇到并发变化会提示冲突；
- 生产调用对限流和上游暂不可用执行有限次、可取消的重试，不重试鉴权、参数或取消错误；
- 正式正文支持 Markdown、TXT 和可直接打开的 DOCX 导出，并提供正文搜索与章节目录；
- 支持 OpenAI、Anthropic、Google、DeepSeek、通义千问、OpenRouter、SiliconFlow、Ollama 和自定义 OpenAI-compatible Provider。

## 界面方向

前端采用编辑部 / 独立出版物式的视觉语言：大字号叙事标题、细线网格、黑白纸张底色和橙色行动色，把“输入想法 → 选择方向 → 生产正文”做成一条清晰的创作路径。桌面端保持高密度工作台，移动端在 `390x844` 下折叠为单列；参考了 Awwwards 收录网站常见的编排、留白和作品展示节奏，但未复制其代码或资源。

参考的产品方向是 [AI-Novel-Writing-Assistant](https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant)，本项目没有复制其代码或资源。

## 环境

- Node.js `>=24`；
- npm；
- Google Chrome 仅在运行 Playwright E2E 时需要。

安装依赖：

```powershell
npm install
```

## 浏览器开发

```powershell
npm run dev
```

打开 `http://127.0.0.1:5173`。服务端只监听 `127.0.0.1:4310`，数据库默认是 `data/xiaoyi.db`；可用 `XIAOYI_DATABASE_PATH` 和 `PORT` 覆盖。

首次使用先点“模型设置”：选择 Provider 后可点击“测试连接”；OpenAI-compatible Provider 可拉取 `/models` 列表，点击“自动选模型”即可填入可用模型。浏览器模式的 API Key 只存在当前标签页 `sessionStorage` 和当前请求内存，不进入 SQLite、生产任务、日志、备份、导出或 API 响应。保存过的会话配置会自动复用匹配端点的 Key，切换端点不会误用旧 Key。

本地自动化可以使用：

```powershell
$env:XIAOYI_FAKE_PROVIDER = "1"
npm run dev
```

## HTTP 接口

服务端提供与创作流程对应的 JSON API，默认地址为 `http://127.0.0.1:4310`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/providers` | Provider 目录（不含凭据） |
| `POST` | `/api/providers/models` | 拉取兼容端点模型列表 |
| `POST` | `/api/providers/test` | 用最小生成请求测试 Provider 连接 |
| `GET` / `POST` | `/api/books` | 列出作品 / 用想法创建作品并生成 3 个方向 |
| `GET` | `/api/books/:bookId` | 读取作品、基础设定、章纲和任务摘要 |
| `GET` | `/api/books/:bookId/directions` | 单独读取方向候选 |
| `POST` | `/api/books/:bookId/directions/:directionId/select` | 选择方向并生成基础设定与章纲 |
| `GET` | `/api/books/:bookId/chapters` | 读取章纲与已采纳正文 |
| `POST` | `/api/books/:bookId/production` | 启动整本生产 |
| `GET` | `/api/production-runs/:runId` | 查询生产进度、候选和检查点 |
| `POST` | `/api/production-runs/:runId/pause\|resume\|cancel` | 控制任务 |
| `POST` | `/api/production-runs/:runId/rewrite` | 为当前章节生成隔离重写候选 |
| `GET` | `/api/chapter-candidates/:candidateId` | 读取候选及审核结果 |
| `PATCH` | `/api/chapter-candidates/:candidateId/text\|memory-review` | 编辑候选或保存记忆审阅 |
| `POST` | `/api/chapter-candidates/:candidateId/accept\|discard` | 原子采纳或丢弃候选 |
| `GET` | `/api/books/:bookId/memory`、`/api/books/:bookId/memory/context/:chapterNumber` | 读取记忆账本 / 预览注入上下文 |
| `GET` / `PATCH` / `POST` | `/api/memory/:entryId/history`、`/api/memory/:entryId`、`/api/memory/:entryId/rollback` | 查看历史、手动修正和回滚记忆 |
| `POST` | `/api/books/:bookId/export` | 导出 Markdown / TXT / DOCX |

所有输入和返回值都经过共享 Zod 契约校验；失败统一返回 `{ "error": { "code", "message" } }`。Electron 桌面端使用同一业务语义的白名单 IPC，不让 Renderer 接触 API Key。

## Windows 桌面版

```powershell
npm run desktop:dev
npm run desktop:build
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
npm run desktop:package:test
```

安装包输出到 `release/XiaoyiNovelWorkbench-<version>-setup.exe`。桌面版 Renderer 只通过白名单 IPC 访问 Main；API Key 由 Main 的 Electron `safeStorage`/Windows DPAPI Vault 管理，Renderer 永远不会收到已保存密钥。

桌面数据库位于 Electron 用户数据目录：

- `xiaoyi.db`：SQLite 工作区；
- `backups/`：数据库备份；
- `provider-settings.json`：不含密钥的 Provider 设置；
- `provider-vault.bin`：加密凭据库。

## 安全边界

- 正文写入必须通过 `expectedRevision`，每次成功修改只增加一次 revision 并保存旧快照；
- 候选冻结基础 revision、上下文 hash 及记忆 revision/hash，正文或记忆基线发生变化后自动过期；记忆变更未经审阅不会 accept，确认后与正文在同一事务中更新历史快照；
- Provider 记忆选择是显式 allow-list：自动模式按关键词相关度筛选，手动模式只允许当前作品中作者选定的非归档条目，选择配置参与上下文 hash，候选 accept 时再次校验；
- 候选正文编辑不会直接修改正式正文；每次编辑增加候选正文 revision、重置审核状态并要求重新审核，只有原子 accept 才会提升章节 revision；
- 首版使用本地 SQLite 的确定性关键词检索和 20,000 字符上下文预算，不引入向量数据库或云端记忆服务；
- 同一候选不能重复采纳或丢弃；
- 生成、审核和修复失败不会污染已采纳正文；
- Electron 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- 未知上游错误只返回归一化公开错误，不暴露 SDK cause、请求头或密钥。

## 验证

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run e2e
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
node scripts/assert-desktop-artifact.mjs
npm run desktop:package:test
npm run desktop:installed:test
```

浏览器 E2E 使用内存数据库和 deterministic provider，覆盖想法输入、三方向选择、生产室、正式正文和 `1440x960`、`1024x768`、`390x844` 视口。若本机默认开发端口被系统占用，可用隔离端口运行：

```powershell
$env:XIAOYI_E2E_SERVER_PORT = "24310"
$env:XIAOYI_E2E_WEB_PORT = "25173"
npm run e2e
```

若 Playwright 在 Windows 无法启动其管理的本地 WebServer 子进程，可在两个终端手动启动 API 和 Vite，再在第三个终端运行外部服务配置：

```powershell
# 终端 1
$env:PORT = "24330"
$env:XIAOYI_DATABASE_PATH = ":memory:"
$env:XIAOYI_FAKE_PROVIDER = "1"
npm run dev:server

# 终端 2
$env:XIAOYI_SERVER_PORT = "24330"
$env:XIAOYI_WEB_PORT = "25190"
npm run dev:web

# 终端 3
$env:XIAOYI_E2E_BASE_URL = "http://127.0.0.1:25190"
npm run e2e:external
```

桌面测试覆盖 IPC、窗口安全、Vault 和打包产物。

## 企业内网 P0 基线

当前版本的企业目标是单用户 / 单租户内网部署，不包含多人协作、多租户和云端协作。已补齐生产所需的访问令牌保护、持久化生产队列、Provider 用量与额度、显式故障转移、审计日志、结构化指标、告警、完整性校验备份及安全恢复脚本。

详细变量、健康探针、备份恢复和升级回滚步骤见 [`docs/operations/enterprise-p0.md`](docs/operations/enterprise-p0.md)。服务端生产启动时设置 `NODE_ENV=production` 和至少 16 位的 `XIAOYI_ACCESS_TOKEN`；`/api/health` 与 `/api/ready` 作为无令牌探针，其余 HTTP API 使用 Bearer 令牌。

### Docker Compose

复制 `.env.example` 为 `.env` 并设置访问令牌后，可以启动包含 Node 应用和 Nginx 同源反向代理的完整部署。默认 HTTP 端口只绑定 `127.0.0.1`：

```powershell
Copy-Item .env.example .env
# 编辑 .env，替换 XIAOYI_ACCESS_TOKEN
npm run docker:up
```

默认从 `http://127.0.0.1:8080` 打开工作台；`npm run docker:status` 查看服务健康状态，`npm run docker:logs` 跟踪日志，`npm run docker:down` 停止服务。局域网 HTTP 使用可控配置 `XIAOYI_HTTP_BIND=0.0.0.0`。公网 HTTPS 部署时，把证书放入被忽略的 `deploy/tls/fullchain.pem` 和 `deploy/tls/privkey.pem`，把允许来源设为公开 `https://` origin，再运行 `npm run docker:up:https`；HTTPS Nginx profile 监听 `XIAOYI_HTTPS_PORT`，默认 HTTP 入口继续留在 loopback。SQLite 数据库和备份位于命名卷中，详细变量及升级/恢复步骤见 [`docs/operations/enterprise-p0.md`](docs/operations/enterprise-p0.md)。

企业运维接口：`GET /api/metrics`、`GET /api/openapi.json`、`GET /api/admin/metrics`、`GET /api/admin/audit`、`GET /api/admin/usage`、`GET /api/admin/runs`、`GET /api/admin/providers`、`GET /api/admin/providers/:index/models`、`POST /api/admin/providers/:index/test`、`GET|POST /api/admin/backups` 和 `POST /api/admin/backups/verify`。成本价格通过 `XIAOYI_MODEL_PRICING_JSON` 注入，备用线路通过 `XIAOYI_FALLBACK_PROVIDERS_JSON` 注入；服务端 Worker 可通过 `XIAOYI_SERVER_PROVIDERS_JSON` 在重启后恢复任务。密钥不写入 SQLite、日志、备份或接口响应。

数据库恢复命令：

```powershell
npm run backup:verify -- <backup.db>
npm run backup:restore -- <backup.db> <target.db>
```
