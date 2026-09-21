# 小奕小说生成工具

小奕现在是一个本地优先的 AI 长篇小说生产工具：你只需要输入一句故事想法，AI 会先按作者选择给出 1–12 套整本方向，再自动完成基础设定、卷章规划、逐章写作、审核修复和正文交付。模型配置支持单模型模式或按规划、写作、审核、修复角色分工的多模型协作模式；配置好后可以直接“一键开写”。

## 使用流程

```text
一句想法 → 选择方向数量 → 单模型/多模型工作流 → 一键开写 / 多套整本方向 → 选择方向 → 记忆选择 → 自动规划 → 逐章生产 → 审核修复 → 候选编辑/Diff → 记忆审阅 → 正式正文
```

- 角色、地点、世界观、伏笔和时间线由 AI 自动生成并作为后台上下文维护，不要求手填资料卡；生产室可打开“故事时间线”和“故事资料卡”，作者随时手动修正；
- 每一章先保存为候选，审核通过后才通过原子 accept 事务进入正式正文；
- 生产任务会保存检查点，关闭应用后可以继续；
- 首页提供悬疑短篇、都市连载和东方幻想预设，也可以只输入自己的想法；方向数量可在 1–12 之间调整；未完成想法会自动保存并在下次打开时恢复，也可以把当前写作方式保存为自定义预设；作品列表显示当前阶段；
- 首页资产库支持保存、搜索、编辑、删除、复制和带入人物、世界观、章法与文风素材，内容默认只保存在当前浏览器本地。
- “工作流”面板可选择单模型，或为规划导演、章节写作、内容审核和问题修复分别指定模型；浏览器端工作流只保存在当前会话，桌面端只提交 Provider ID 和模型名，由 Main/Vault 按角色解析独立凭据。无密钥固定地址 Provider 可直接跨选；需要 API Key 或自定义地址的 Provider 需先在模型设置中分别保存；
- 生产室支持暂停、继续、停止、失败阶段重试和重新选择当前模型；应用启动时会自动恢复排队中/运行中的任务；
- 生产室支持对当前章节发起 AI 重写，重写结果仍然是隔离候选，必须审核并采纳后才会进入正文；
- Provider 设置支持关闭/低/中/高思考等级；OpenAI、Anthropic、Google 和 OpenAI-compatible 会按各自原生参数映射，不支持时安全降级为关闭。
- 生产室与用量接口记录输入/输出/缓存读写 Token、缓存命中率和估算费用；不同模型阶段携带统一 `xiaoyi-context-v1` 上下文同步包和记忆指纹。
- 生产室提供独立的“长篇记忆中心”：自动维护世界规则、人物状态、事实、时间线、伏笔和文风约束，按当前章节筛选后注入 draft/review/repair；
- 记忆中心支持“自动推荐”或“仅发送选中”：作者可逐条勾选本地记忆，只有选中的条目会进入当前生产任务的 Provider prompt，空选择表示不发送记忆；这项选择冻结在生产 run 和候选上，不改变本地记忆账本；
- 章节审核会逐条展示 AI 提议的记忆新增、更新和解决，作者确认后才会与正文在同一事务中落盘；全部忽略也可以继续生产；
- 候选正文在 accept 前可以手动编辑；编辑采用 candidate text revision 乐观锁，保存后会清空旧审核/记忆提议并重新审核，Diff 保留初始候选与当前候选的逐行变化；
- 记忆中心会显示每条注入记忆的选择原因，支持查看完整 revision 历史并把条目回滚为新的手动修正 revision；
- 记忆条目带独立 revision 和历史快照，可锁定/解锁或进行 JSON 高级修正；锁定内容不会被 AI 自动覆盖，手动修改遇到并发变化会提示冲突；
- 时间线每章使用作品 revision 乐观锁保存；保存成功后后续生成、审核和记忆上下文都会读取新标题、摘要、章节目标、钩子与伏笔，冲突时保留当前编辑草稿；
- 生产调用对限流和上游暂不可用执行有限次、可取消的重试，不重试鉴权、参数或取消错误；
- 正式正文支持 Markdown、TXT 和可直接打开的 DOCX 导出，并提供正文搜索与章节目录；
- 正式正文新增 ePub 导出、打印排版（浏览器保存 PDF）和 Markdown/TXT/DOCX 批量导入；导入与全文替换都按作品 revision 写入，锁定章节会拒绝覆盖；
- “创作中枢”集中提供作品健康度、场景编辑器、人物知识边界、伏笔生命周期、作者笔记、每日目标、术语锁定、系列资料库、Prompt 版本与生产配方；工作区数据与作品分离持久化，冲突时不会静默覆盖；
- 创作中枢的术语、人物知识边界、启用 Prompt 版本和匹配的生产配方会冻结进每次生成上下文；上下文解释器显示工作区版本，规则变化后旧候选会自动过期；
- DOCX 导入限制归档大小和解压输出，批量替换先做只读预检并显示命中范围，确认后才写入；
- 支持 OpenAI、Anthropic、Google、DeepSeek、通义千问、OpenRouter、SiliconFlow、Ollama 和自定义 OpenAI-compatible Provider。
- 企业部署可开启账号邀请码模式：管理员创建带最大注册次数和过期时间的邀请码；没有邀请码不能注册账号，注册后使用用户名和密码登录。密码哈希和会话令牌只保存安全摘要，账号只能看到自己的作品，管理员令牌保留运维权限。
- 注册用户可以在浏览器“模型设置”中自行填写 Provider、模型、端点和 API Key；用户 Key 只保存在当前浏览器会话并随当前请求使用，不要求管理员把用户 Key 注入服务端。`XIAOYI_SERVER_PROVIDERS_JSON` 仅用于可选的服务端托管 Provider 和重启后的后台恢复。
- 故事资料卡支持结构化表单编辑；时间线支持批量保存、未采纳章节安全重排和 AI 重新规划 Diff，必须由作者确认后才会采纳。
- 生产室新增一致性检查和全局搜索，检查人物/地点/时间线/伏笔/矛盾状态，并搜索资料卡、章纲和已采纳正文。
- 桌面端更新检查会校验 HTTPS 更新源和 Windows 签名；本地备份可用 `XIAOYI_BACKUP_PASSWORD=<12位以上密码> npm run backup:encrypt -- --input backup.db --output backup.db.xb` 加密保存，也可用 `backup:decrypt` 解密恢复。
- 桌面数据管理对已登录用户提供加密备份导出，密码不会写入日志、数据库或备份文件；更新下载完成后会提示重启安装。
- 桌面端当前使用离线授权：管理员用本地私钥生成签名邀请码，用户首次启动桌面端输入邀请码后才能注册账号。生成示例：`npm run desktop:invite -- --private-key secrets/desktop-invitation-private.pem --max-uses 1 --expires-at 2026-12-31T00:00:00.000Z`。私钥位于被 Git 忽略的 `secrets/` 目录，生产使用前应替换为自己的密钥对并重新构建桌面端。
- 桌面发布包启用 ASAR、去除生产 source map、关闭打包版 DevTools、拒绝常见调试启动参数，并依赖 Windows 代码签名提高篡改和逆向成本；这些措施不能替代服务端授权，也不能保证离线程序绝对不可破解。
- 本轮主动安全审查记录在 [`security_best_practices_report.md`](security_best_practices_report.md)，结论是没有新增 Critical/High 问题；浏览器 sessionStorage 会话和离线程序可被本机分析属于已记录的设计残余风险。

## 界面方向

前端采用 Xiaoyi Studio 的沉浸式工作台语言：近黑画布、紫色主操作色、细边框和低干扰层级，玻璃材质只用于顶栏、抽屉和临时操作层。首页把故事想法作为第一视觉主体，并以带封面、书脊和书页厚度的 CSS 立体书架呈现真实作品；作品入口支持书架/列表切换。生产室提供章节树、正文/候选审核、章纲和上下文工具组成的三栏工作区，左右栏可收起、调整宽度，专注模式隐藏两侧控制栏并可用 `Escape` 退出。全局工作区导航从顶栏打开左侧抽屉，保留当前页面与作品上下文；页面顶栏复用快捷操作组和状态反馈条，平板/移动端的章节与上下文栏改为可关闭的侧抽屉。模型工作流模式使用带说明、选中态和键盘操作的暗色选择器，多模型协作按规划导演、章节写作、内容审核和问题修复分组展示。方向卡片聚焦后按 `Space` Peek 预览，`Ctrl/Cmd + K` 打开按上下文过滤的快速操作面板；所有主要动画都响应 `prefers-reduced-motion`。桌面端保持高密度工作台，移动端在 `390x844` 下折叠为单列且不产生页面横向滚动。

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

首次使用先点“模型设置”：选择 Provider 后可点击“测试连接”；OpenAI-compatible Provider 可拉取 `/models` 列表，点击“自动选模型”即可填入可用模型。浏览器模式的 API Key 只存在当前标签页 `sessionStorage` 和当前请求内存，不进入 SQLite、生产任务、日志、备份、导出或 API 响应。保存过的会话配置会自动复用匹配端点的 Key，切换端点不会误用旧 Key；工作流也只保存在当前标签页。

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
| `GET` / `POST` | `/api/books` | 列出作品 / 用想法创建作品并按 `directionCount` 生成 1–12 个方向；请求可携带 `provider` 或 `workflow` |
| `GET` | `/api/books/recoverable` | 返回启动恢复所需的可恢复作品 ID（不返回密钥或正文） |
| `GET` | `/api/books/recoverable/details` | 一次返回启动恢复需要的作品详情（不返回密钥） |
| `GET` | `/api/books/:bookId` | 读取作品、基础设定、章纲和任务摘要 |
| `GET` | `/api/books/:bookId/directions` | 单独读取方向候选 |
| `POST` | `/api/books/:bookId/directions/:directionId/select` | 选择方向并生成基础设定与章纲 |
| `GET` | `/api/books/:bookId/chapters` | 读取章纲与已采纳正文 |
| `PATCH` | `/api/books/:bookId/timeline/:planId` | 使用作品 revision 修改 AI 生成的卷章时间线 |
| `PATCH` | `/api/books/:bookId/timeline` | 批量修改卷章时间线 |
| `POST` | `/api/books/:bookId/timeline/reorder` | 安全重排未采纳章节 |
| `POST` | `/api/books/:bookId/timeline/preview` | 生成 AI 时间线 Diff 预览 |
| `GET` | `/api/books/:bookId/search` | 搜索资料卡、章纲和正文 |
| `GET` | `/api/books/:bookId/consistency` | 检查故事一致性 |
| `GET` / `PATCH` | `/api/books/:bookId/authoring-workspace` | 读取 / revision-safe 保存创作中枢资料 |
| `POST` | `/api/books/:bookId/replace` | revision-safe 批量替换章纲和正文 |
| `POST` | `/api/books/:bookId/import` | 导入 Markdown / TXT / DOCX 正文 |
| `GET` | `/api/usage` | 读取当前周期 Token 与费用统计 |
| `POST` | `/api/books/:bookId/production` | 启动整本生产 |
| `GET` | `/api/production-runs/:runId` | 查询生产进度、候选和检查点 |
| `POST` | `/api/production-runs/:runId/pause\|resume\|cancel` | 控制任务 |
| `POST` | `/api/production-runs/:runId/rewrite` | 为当前章节生成隔离重写候选 |
| `GET` | `/api/chapter-candidates/:candidateId` | 读取候选及审核结果 |
| `PATCH` | `/api/chapter-candidates/:candidateId/text\|memory-review` | 编辑候选或保存记忆审阅 |
| `POST` | `/api/chapter-candidates/:candidateId/accept\|discard` | 原子采纳或丢弃候选 |
| `GET` | `/api/books/:bookId/memory`、`/api/books/:bookId/memory/context/:chapterNumber` | 读取记忆账本 / 预览注入上下文 |
| `GET` / `PATCH` / `POST` | `/api/memory/:entryId/history`、`/api/memory/:entryId`、`/api/memory/:entryId/rollback` | 查看历史、手动修正和回滚记忆 |
| `POST` | `/api/books/:bookId/export` | 导出 Markdown / TXT / DOCX / ePub |
| `POST` | `/api/auth/register` | 使用邀请码注册账号并登录 |
| `POST` | `/api/auth/login` | 账号登录 |
| `POST` | `/api/auth/logout` | 退出当前账号会话 |
| `GET` / `POST` | `/api/admin/invitations` | 管理员查看 / 创建邀请码 |
| `POST` | `/api/admin/invitations/:invitationId/revoke` | 管理员撤销邀请码及其会话 |

所有输入和返回值都经过共享 Zod 契约校验；失败统一返回 `{ "error": { "code", "message" } }`。Electron 桌面端使用同一业务语义的白名单 IPC，不让 Renderer 接触 API Key。

## Windows 桌面版

```powershell
npm run desktop:dev
npm run desktop:build
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
npm run desktop:package:test
npm run clean:generated
```

安装包输出到 `release/XiaoyiNovelWorkbench-<version>-setup.exe`。桌面版 Renderer 只通过白名单 IPC 访问 Main；API Key 由 Main 的 Electron `safeStorage`/Windows DPAPI Vault 管理，Renderer 永远不会收到已保存密钥。桌面工作流设置同样通过白名单 IPC 持久化为无密钥选择；跨 Provider 的角色使用各自已保存的 credentialId，Renderer 不接收密钥。

`npm run clean:generated` 只清理 `dist/`、Playwright 报告、截图和临时桌面构建目录，不触碰 `data/`、`backups/`、`secrets/`、`.worktrees/`、`release/` 或 `node_modules/`。

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

浏览器 E2E 使用内存数据库和 deterministic provider，覆盖想法输入、可变方向数量、协作工作流、方向选择、生产室、正式正文和 `1440x960`、`1024x768`、`390x844` 视口。测试默认使用独立的 `24310`/`25173` 端口，不占用开发服务的 `4310`/`5173`；若本机仍有端口冲突，可覆盖端口运行：

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

### 邀请码模式

生产环境设置 `XIAOYI_INVITATIONS_REQUIRED=1` 后，作者 API 需要账号登录；注册接口必须提供邀请码，`XIAOYI_ACCESS_TOKEN` 仍是管理员令牌，用于创建、查看和撤销邀请码。创建响应中的 `code` 只返回一次，SQLite 只保存邀请码哈希、密码哈希和会话哈希。

```powershell
$headers = @{ Authorization = "Bearer $env:XIAOYI_ACCESS_TOKEN" }
$invite = Invoke-RestMethod http://127.0.0.1:8080/api/admin/invitations -Method Post `
  -Headers $headers -ContentType 'application/json' -Body '{"maxUses":10}'
$invite.code

Invoke-RestMethod http://127.0.0.1:8080/api/auth/register -Method Post `
  -ContentType 'application/json' `
  -Body (@{ inviteCode = $invite.code; username = 'writer'; password = 'a-strong-password-123' } | ConvertTo-Json)
```

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
npm run backup:restore -- <backup.db> <target.db> --offline
```
