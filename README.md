# 小奕小说生成工具

小奕现在是一个本地优先的 AI 长篇小说生产工具：你只需要输入一句故事想法，AI 会先给出 3 套整本方向，再自动完成基础设定、卷章规划、逐章写作、审核修复和正文交付。

## 使用流程

```text
一句想法 → 3 套整本方向 → 选择方向 → 记忆选择 → 自动规划 → 逐章生产 → 审核修复 → 候选编辑/Diff → 记忆审阅 → 正式正文
```

- 角色、世界观、伏笔和时间线由 AI 自动生成并作为后台上下文维护，不要求手填角色卡；
- 每一章先保存为候选，审核通过后才通过原子 accept 事务进入正式正文；
- 生产任务会保存检查点，关闭应用后可以继续；
- 生产室支持暂停、继续、停止和查看章节审核记录；
- 生产室提供独立的“长篇记忆中心”：自动维护世界规则、人物状态、事实、时间线、伏笔和文风约束，按当前章节筛选后注入 draft/review/repair；
- 记忆中心支持“自动推荐”或“仅发送选中”：作者可逐条勾选本地记忆，只有选中的条目会进入当前生产任务的 Provider prompt，空选择表示不发送记忆；这项选择冻结在生产 run 和候选上，不改变本地记忆账本；
- 章节审核会逐条展示 AI 提议的记忆新增、更新和解决，作者确认后才会与正文在同一事务中落盘；全部忽略也可以继续生产；
- 候选正文在 accept 前可以手动编辑；编辑采用 candidate text revision 乐观锁，保存后会清空旧审核/记忆提议并重新审核，Diff 保留初始候选与当前候选的逐行变化；
- 记忆中心会显示每条注入记忆的选择原因，支持查看完整 revision 历史并把条目回滚为新的手动修正 revision；
- 记忆条目带独立 revision 和历史快照，可锁定/解锁或进行 JSON 高级修正；锁定内容不会被 AI 自动覆盖，手动修改遇到并发变化会提示冲突；
- 生产调用对限流和上游暂不可用执行有限次、可取消的重试，不重试鉴权、参数或取消错误；
- 正式正文支持 Markdown、TXT 导出，DOCX 接口保留在扩展位；
- 支持 OpenAI、Anthropic、Google、DeepSeek、通义千问、OpenRouter、SiliconFlow、Ollama 和自定义 OpenAI-compatible Provider。

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

首次使用先点“模型设置”保存 Provider。浏览器模式的 API Key 只存在当前标签页 `sessionStorage` 和当前请求内存，不进入 SQLite、生产任务、日志、备份、导出或 API 响应。

本地自动化可以使用：

```powershell
$env:XIAOYI_FAKE_PROVIDER = "1"
npm run dev
```

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

浏览器 E2E 使用内存数据库和 deterministic provider，覆盖想法输入、三方向选择、生产室、正式正文和 `1440x960`、`1024x768`、`390x844` 视口。桌面测试覆盖 IPC、窗口安全、Vault 和打包产物。
