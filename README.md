# 小奕小说生成工具

小奕是一个本地优先的长篇小说创作工作台。章节编辑、revision 保护和多模型生成位于同一条可审计流程中：模型先生成独立候选，作者明确采纳后才写入正文。

## 已实现

- 自动创建本地项目和首个章节；
- 章节切换、新建、字数统计和 800ms 自动保存；
- SQLite 完整 revision 快照与 optimistic locking；
- 原生 OpenAI、Anthropic、Google 适配器；
- DeepSeek、通义千问、OpenRouter、SiliconFlow、Ollama 和自定义 OpenAI-compatible 端点；
- 续写、改写、润色候选及用量展示；
- 候选显式采纳或丢弃，重复采纳和过期 revision 会被拒绝；
- 桌面三栏工作台与移动端章节/生成抽屉。

设计规格见 [本地写作工作台设计](docs/superpowers/specs/2026-08-03-local-writing-workbench-design.md)，实施记录见 [开发计划](docs/superpowers/plans/2026-08-03-local-writing-workbench.md)。

## 环境要求

- Node.js 24 或更高版本；
- npm；
- Google Chrome，仅运行端到端和截图测试时需要。

## 本地运行

```powershell
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。Vite 会把 `/api` 代理到只监听 `127.0.0.1:4310` 的本地服务。

数据库默认位于 `data/xiaoyi.db`，同目录会出现 SQLite WAL 文件。停止本地服务后再备份这些文件。可用 `XIAOYI_DATABASE_PATH` 指定其他数据库文件，服务端口可用 `PORT` 调整。

## 模型配置

从左侧模型按钮或生成面板底部打开配置。模型 ID 始终可编辑；自定义兼容端点还允许编辑服务地址。

| 入口 | 适配方式 |
| --- | --- |
| OpenAI | 官方 SDK，Responses API |
| Anthropic | 官方 SDK，Messages API |
| Google Gemini | 官方 Google GenAI SDK |
| DeepSeek、通义千问、OpenRouter、SiliconFlow | OpenAI-compatible Chat Completions |
| Ollama | 本地 OpenAI-compatible 端点，默认无需 Key |
| 自定义兼容端点 | 用户提供 HTTP(S) base URL、模型 ID 和可选凭据 |

API Key 只写入当前标签页的 `sessionStorage`，不会进入 SQLite、生成记录、服务端日志或响应。关闭标签页会清除会话配置。

## 数据与生成边界

- 所有章节修改都携带 `expectedRevision`，成功后 revision 只增加一次；
- 自动保存冲突会保留浏览器中的本地草稿，不静默覆盖数据库；
- 生成任务冻结章节 `baseRevision`，候选完成时正文保持不变；
- 采纳在单个事务中校验 generation 状态和章节 revision；
- 丢弃候选不会修改章节；
- API Key 仅参与当前模型请求，不持久化。

## 验证命令

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run e2e
```

`npm run e2e` 使用内存数据库和显式测试 provider，覆盖自动保存、候选隔离、单次采纳、刷新持久化，以及 `1440x960`、`1024x768`、`900x844`、`390x844` 四种视口。截图输出到忽略提交的 `output/playwright/`。

其他常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm test` | Vitest 监听模式 |
| `npm run dev:server` | 仅启动 Hono/SQLite 服务 |
| `npm run dev:web` | 仅启动 Vite 客户端 |
| `npm run start` | 启动 `dist/server` 中已构建的 API 服务 |

## 当前限制

- 首版是单用户、单本地项目工作台；
- revision 历史已保存，但尚无历史浏览和恢复界面；
- 暂无流式生成、项目导入导出、角色卡、正典库和长篇检索记忆；
- API Key 尚未接入系统密钥链；
- `npm run start` 只启动已构建 API，客户端仍需独立静态托管；
- 尚未封装 Tauri 安装包。

下一里程碑是加入项目管理、章节历史恢复和结构化故事资料，再评估 Tauri 封装与系统密钥链。
