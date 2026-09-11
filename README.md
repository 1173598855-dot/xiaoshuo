# 小奕小说生成工具

小奕现在是一个本地优先的 AI 长篇小说生产工具：你只需要输入一句故事想法，AI 会先给出 3 套整本方向，再自动完成基础设定、卷章规划、逐章写作、审核修复和正文交付。

## 使用流程

```text
一句想法 → 3 套整本方向 → 选择方向 → 自动规划 → 逐章生产 → 审核修复 → 正式正文
```

- 角色、世界观、伏笔和时间线由 AI 自动生成并作为后台上下文维护，不要求手填角色卡；
- 每一章先保存为候选，审核通过后才通过原子 accept 事务进入正式正文；
- 生产任务会保存检查点，关闭应用后可以继续；
- 生产室支持暂停、继续、停止和查看章节审核记录；
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
- 候选冻结基础 revision 和上下文 hash，正文发生变化后自动过期；
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
