# Windows Desktop Progress

## 当前状态

- Tasks 4–9：实现、针对性测试和复审已完成；桌面 Provider Vault、数据库维护、窄类型 IPC、Renderer transport、原生生命周期、smoke、Electron E2E、更新检查和 NSIS 打包路径均已落地。
- Task 10：README、AGENTS、已批准设计和实施计划已同步；Audit A–F 均已整改并通过复审。Audit F 保证浏览器会话 Key 可单独清除、外链默认拒绝，以及候选导入的外键/共享工作区语义校验。
- 当前分支：`main`；工作区保留完整未提交改动，没有 stage、commit 或 push。

## 最新自动化证据（2026-08-11）

- `npm run lint`、`npm run typecheck`：均 exit 0。
- `npm run test:run`：35 files / 218 tests passed。
- `npm run build`：客户端、服务端和 built-server smoke 通过。
- `.\node_modules\.bin\cross-env.cmd XIAOYI_E2E_SERVER_PORT=14310 XIAOYI_E2E_WEB_PORT=15173 npm run e2e`：6 个浏览器 E2E 通过；默认 `4310` 被无关本机进程占用，因此采用现有测试端口覆盖。受限沙箱会在 Playwright 用 Windows `taskkill` 清理自建服务时挂起；已在真实桌面环境获得正常退出码。
- `npm run smoke:desktop`：`nodeMajor: 24`、`sqlite: true`、`ipc: true`、`rendererLoaded: true`。
- `npm run desktop:test`：1 个 Electron E2E 通过。
- `.\node_modules\.bin\cross-env.cmd CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist`：NSIS x64 安装包和 blockmap 生成；`node scripts/assert-desktop-artifact.mjs` 确认安装包为 107043778 bytes。
- `npm run desktop:package:test`：1 个真实 `release/win-unpacked` EXE 的隔离 E2E 通过；先验证临时 userData 安全闸，再覆盖 `file:` 加载、`Ctrl+S` 离线保存、重启持久化、明文 Key 扫描和无 Main TCP 监听。
- `git diff --check`：exit 0，仅有 Git 行尾规范化提示。
- 本轮补充的 RED/GREEN：浏览器/桌面 E2E suite 隔离、已提交恢复标记在后续编辑后的安全重启、数据管理对话框的键盘焦点边界；完整记录见桌面实施计划。

## 高度自审续开发证据（2026-08-11）

- 导入候选数据库现在逐条验证 generation 的 provider、上下文、状态机和规范化公开错误信息；针对非 catalog provider ID 与非规范错误信息的两条回归测试通过。
- 每个 BrowserWindow session 都显式拒绝 permission、permission request 和 display-media request；`tests/desktop/window-security.test.ts` 3/3 通过。
- smoke 子进程监督现在在创建后立即订阅 `error`/`exit`，严格校验健康 payload 的类型，健康 JSON 后等待自然 `exit(0)`，失败/超时时才进行有界终止；`tests/desktop/smoke-process.test.ts` 4/4 通过，并覆盖 spawn failure、non-zero exit、`kill()` 返回 false、定时器清理和错误的 Node 版本类型。
- `npm run test:run`：36 files / 227 tests passed；`npm run lint`、`npm run typecheck`、`npm run build`：均 exit 0。
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist` 与 `node scripts/assert-desktop-artifact.mjs`：均 exit 0；当前安装包为 107047800 bytes。
- 隔离端口浏览器 E2E 的 6 项断言均通过，但 Playwright 在 Windows 清理阶段未在 120 秒内退出；两端口均已释放。
- 本机 Electron Renderer 受 `GPU process exited unexpectedly: exit_code=-1073741515` 阻断：smoke 在 60 秒后正确失败，`desktop:test` 报 `Target crashed`；测试残留 Electron 已清理。不得把该主机上的 GUI 门禁误报为通过。

## 受限宿主续验证（2026-08-11）

- 根因对照：同一已构建应用使用 Electron 进程参数 `--no-sandbox` 后立即输出完整 smoke 健康 payload，确认阻断来自本机 Chromium 进程沙箱，而非 Main、Preload、IPC、SQLite 或 Renderer 工作流。
- `scripts/electron-test-runtime.mjs` 只在 `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1` 时为 smoke、源码 E2E 和打包 E2E 返回 `--no-sandbox`；默认及任何其他值均为空数组。它不由安装包、Main、Preload 或 Renderer 引用。
- RED：`tests/desktop/electron-test-runtime.test.ts` 因模块不存在失败；GREEN：2 个显式 opt-in/默认拒绝断言通过。新增声明文件后，`npm run typecheck` 通过。
- `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1 npm run smoke:desktop`：exit 0，`nodeMajor: 24`、`sqlite: true`、`ipc: true`、`rendererLoaded: true`。
- `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1 npm run desktop:test`：exit 0，1 个 Electron E2E 通过。
- `npm run lint`、`npm run typecheck`、`npm run test:run`：均 exit 0；完整 Vitest 为 37 files / 229 tests passed。
- `npm run build`：exit 0；客户端、服务端和 built-server smoke 通过。
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist`：exit 0；`node scripts/assert-desktop-artifact.mjs` 确认安装包为 107047796 bytes。
- `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1 npm run desktop:package:test`：exit 0，真实 `win-unpacked` EXE 的隔离 E2E 通过。
- `XIAOYI_E2E_SERVER_PORT=14310 XIAOYI_E2E_WEB_PORT=15173 npm run e2e`：6/6 浏览器断言均通过，但 Playwright 在 Windows WebServer 清理阶段超出 180 秒；两个隔离端口均已释放。

## 本轮续开发与自审（2026-08-12）

- 共享 `ChapterSchema` 现与章节写入使用相同的 2,000,000 字符上限，避免 HTTP/IPC 返回、工作区校验与编辑输入的契约漂移。RED：新增共享契约测试在修复前以 `expected true to be false` 失败；GREEN：`tests/shared/contracts.test.ts` 8/8 通过。
- `npm run lint`、`npm run typecheck`、`npm run test:run`（37 files / 238 tests）和 `npm run build` 均 exit 0。
- `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1 npm run smoke:desktop`、`XIAOYI_ELECTRON_TEST_NO_SANDBOX=1 npm run desktop:test`、`XIAOYI_ELECTRON_TEST_NO_SANDBOX=1 npm run desktop:package:test` 均 exit 0；后两项均为 1/1 Electron E2E 通过。
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist` 与 `node scripts/assert-desktop-artifact.mjs` 均通过；当前 NSIS 安装包为 107048931 bytes。
- `XIAOYI_E2E_SERVER_PORT=14313 XIAOYI_E2E_WEB_PORT=15176 npm run e2e` 完成 6/6 浏览器断言，但 Windows WebServer 清理在 300 秒后超时；两端口已确认释放，故命令不记为通过。
- 在允许 Windows 子进程清理的桌面环境中，`XIAOYI_E2E_SERVER_PORT=14314 XIAOYI_E2E_WEB_PORT=15177 npm run e2e` 完整 exit 0，6/6 浏览器 E2E 通过，两个端口均已释放；前一项超时属于受限执行环境，而不是产品回归。
- 较早的受限宿主中，默认 `npm run smoke:desktop` 曾在 60 秒后失败并输出两次 `GPU process exited unexpectedly: exit_code=-1073741515`；默认沙箱的附加 GPU 诊断也未得到健康 payload。所有诊断进程均已清理，且不应通过放宽产品安全选项规避该宿主问题。后续提升权限的最新默认沙箱重跑已通过，见下方最终验收记录。

## 最终验收续跑与高强度自审（2026-08-12）

- 导入完成后的 reload 保持数据管理对话框和成功状态；模型配置与数据管理改为单一 `activeDialog`，同一 React 批次连续的原生命令不会产生两个 modal。对应 `desktop-lifecycle` 回归由 RED 到 GREEN，现为 12/12。
- 安装验收脚本在安装尝试开始时登记所有权；失败时只清理目标位于本次临时安装目录的快捷方式。子进程使用 120 秒超时、`taskkill /T` 和有界等待；快捷方式启动也按进程树终止。`findUninstaller`、安全快捷方式清理、输出流 close 收敛和超时清理均由 `installed-acceptance-script` 14/14 覆盖。
- 打包 EXE 验收在重启后再次扫描同一隔离资料目录的明文 Key，检查 Main 与全部子进程的 TCP listener（仅允许 Playwright 注入的两条 Main inspector listener），并在关闭异常时以进程树终止兜底。
- 初次完整 Vitest 在候选渲染等待处有一次 1 秒超时；目标测试 1/1、该文件 9/9 和最新完整重跑均未复现，未通过无依据延长超时掩盖问题。
- 最新完整门禁：`npm run lint`、`npm run typecheck` 均 exit 0；`npm run test:run` 为 38 files / 255 tests；`npm run build` 通过。`XIAOYI_E2E_SERVER_PORT=14316 XIAOYI_E2E_WEB_PORT=15179 npm run e2e` 为 6/6 且 exit 0。默认安全沙箱下 `npm run smoke:desktop` 返回 Node 24、SQLite、IPC、Renderer 全部健康，`npm run desktop:test` 为 1/1。
- `npx cross-env CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist` 通过；`node scripts/assert-desktop-artifact.mjs` 验证 107048776-byte NSIS 包。`npm run desktop:package:test` 为 1/1，`npm run desktop:installed:test` 完成临时安装、快捷方式启动、安装版 E2E 和卸载清理。
- 唯一发布外部风险不变：`desktop:installed:test` 是当前 Windows 用户下的隔离验收，且为隔离 profile 会在验证初始空参数后临时修改快捷方式。它不能替代 disposable Windows 用户/VM 中未经修改默认快捷方式、DPAPI/safeStorage 和用户环境的 clean-profile 验收。

完整命令、RED/GREEN 记录和逐项验收证据见：

- `docs/superpowers/plans/2026-08-03-windows-desktop-app.md`
- `.superpowers/sdd/audit-c-fix-report.md`
- `.superpowers/sdd/audit-d-fix-report.md`
- `.superpowers/sdd/audit-e-fix-report.md`
- `.superpowers/sdd/audit-f-fix-report.md`

## 审计材料分类

- `*-report.md`：实现或整改结果报告。
- `*-brief.md`：任务与复审输入。
- `*-review-package.*`、`*-review.diff`：只读复审快照。

这些材料用于追溯，不参与运行时或安装包；在明确归档策略前保留原位。

## 本轮自主续开发与高强度自审（2026-08-12）

- 上下文恢复确认桌面版 Tasks 4-10 与 Audit A-F 已落地；本轮没有重复实现已有运行时代码，只处理新鲜全量门禁暴露的客户端测试契约回归。
- RED：`npm run test:run` 首次为 38 files / 269 tests，其中 `tests/client/App.test.tsx` 和 `tests/client/desktop-lifecycle.test.tsx` 的 3 个用例在空章节工作区等待或查找同名“新建章节”按钮/错误 alert 时失败。根因是空章节状态现在同时提供章节栏和主工作区两个合法创建入口，且不再渲染错误 alert。
- GREEN：测试改为按 `main[aria-label="空章节工作区"]` 语义区域定位，并以空工作区节点作为加载完成信号；运行时代码未改动。目标文件 2 files / 27 tests 通过，完整 Vitest 为 38 files / 269 tests 通过。
- 新鲜通用门禁：`npm run lint`、`npm run typecheck`、`npm run build` 均 exit 0；浏览器 E2E 使用隔离端口 14320/15183 为 6/6；`npm run smoke:desktop` 健康 payload 的 Node 24、SQLite、IPC、Renderer 全部通过；`npm run desktop:test` 为 1/1。
- 新鲜发布门禁：`CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist`、`node scripts/assert-desktop-artifact.mjs`、`npm run desktop:package:test` 和 `npm run desktop:installed:test` 均 exit 0。打包 EXE 隔离验收 1/1，NSIS 临时安装、开始菜单快捷方式、安装版验收和卸载清理均通过；产物检查记录 107050289 bytes。
- 独立自审核对了 Main/Preload/IPC 白名单与 sender 信任、凭据不落盘边界、Provider Vault、数据库导入回滚、generation baseRevision/accept 事务、窗口安全、关闭握手、发布脚本和测试/文档 diff。源码扫描命中的 `sk-*` 均为测试哨兵或显式测试输入；没有发现新的运行时凭据/原始 cause 泄漏路径。
- 收尾确认没有残留 Electron 应用进程。`127.0.0.1:4310` 仍由无关的 `QQ.exe`（PID 26256）占用，不是本项目测试服务；本轮浏览器测试使用隔离端口并已完成。
- 干净 Windows 用户/VM 下的未修改默认快捷方式、DPAPI/safeStorage 和人工热键验收仍是外部未完成项；本轮未修改其计划状态，也未创建 Git commit。

## 剩余事项

1. 在默认 Chromium 沙箱可运行的干净 Windows 用户配置中完成 NSIS 已安装产物的开始菜单启动、离线编辑、`Ctrl+N`、`Ctrl+O`、`Ctrl+Shift+E`、`Ctrl+,`、导入导出、候选采纳一次和密钥检查。当前会话已验证静默安装、开始菜单快捷方式目标和静默卸载；受限测试模式下的离线保存、重启持久化、明文 Key 扫描和监听端口已有打包 EXE 自动化覆盖，但不能替代默认沙箱下的已安装产物人工复核。
2. 人工验收后更新实施计划；收到明确指令后再创建最终 Git commit。

说明：electron-builder 当前仅提示 `package.json` 缺少 `description` 和 `author`，不影响打包成功；在作者署名未明确前不代填。

## 本轮自主续开发与高强度自审（2026-08-12，导入后 autosave 回归）

- 上下文恢复确认前序桌面版实现、自动化门禁和未提交用户改动均需保留；本轮最高优先级缺陷是：导入数据库后，同一章节 `id` 与 `revision` 不变但正文被替换时，客户端可能把导入正文误判为本地脏稿并在 debounce 后再次 PATCH。
- RED：新增 `tests/client/desktop-lifecycle.test.tsx` 回归先失败，观察到 `api.chapter.update` 被调用一次且提交导入正文；新增 autosave identity 测试在 helper 尚未接入时也按预期暴露测试结构问题，随后修正为可执行的行为测试。
- GREEN：`src/client/hooks/use-workspace.ts` 为每次成功工作区加载递增 `workspaceEpoch`；`src/client/App.tsx` 将 `${workspaceEpoch}:${chapterId}` 作为 autosave identity；`src/client/hooks/use-autosave.ts` 仅在 identity 仍匹配时执行 `onSaved`、revision 和 saved-content 更新，阻止旧工作区响应污染新工作区。测试同时覆盖同一章节 ID/revision 的 reload 和在途旧保存响应。
- 目标验证：`npm run test:run -- tests/client/use-autosave.test.tsx tests/client/desktop-lifecycle.test.tsx` exit 0，2 files / 19 tests passed。导入回归关闭数据管理对话框后等待 900ms，确认 `api.chapter.update` 未调用且编辑器保留导入正文。
- 本轮修改仅涉及 autosave/workspace identity 生产逻辑与对应客户端回归测试；未回滚或覆盖其他未提交改动，未创建 Git commit。完整门禁和最终 diff 自审待本轮后续验证完成后补录。

## 本轮继续开发与高度自审（2026-08-12，安装版菜单命令验证）

- 新鲜 `npm run desktop:package:test` 首次复现安装版验收不稳定：一次在 `Ctrl+N` 后章节数未增加，另一次在导出步骤等待按钮超时。对照实验确认 Electron `MenuItem.click()` 稳定成功，失败集中在 PowerShell/WScript/Win32 模拟物理按键的宿主前台输入边界；没有发现 Main、IPC、Renderer 或数据库业务回归。
- RED/GREEN：`e2e/packaged-workbench.spec.ts` 原先依赖 `WScript.Shell.SendKeys`；现改为执行真实应用菜单中 accelerator 对应的 `MenuItem`，并断言五个 accelerator 注册值。该验证仍经过 Main 菜单回调、`webContents.send`、Preload schema 和 Renderer handler，不把不稳定的物理按键注入伪装成自动化通过。
- 目标验证：`npx eslint e2e/packaged-workbench.spec.ts --max-warnings 0` 通过；客户端/安装脚本回归 3 files / 34 tests 通过；`npm run desktop:package:test` 1/1 通过。
- 物理 `Ctrl+S`、`Ctrl+N`、`Ctrl+O`、`Ctrl+Shift+E`、`Ctrl+,` 仍属于未完成的干净 Windows 用户/VM 人工验收；本轮未修改该计划状态，也未创建 Git commit。

## 本轮桌面安全修复闭环（2026-08-14）

- 已完成并验证五项修复：活动数据库在启动备份/导出前做只读 schema 校验；generation usage 使用严格共享契约并在 repository 出站解析；Provider Vault 使用 V2 credential reference、设置提交原子顺序和持久撤销标记；关闭握手贯穿 UUID requestId 并忽略过期响应。
- RED/GREEN 聚焦证据：`tests/shared/contracts.test.ts`、`tests/desktop/database-manager.test.ts`、`tests/desktop/provider-vault.test.ts`、`tests/desktop/lifecycle-handshake.test.ts` 及相关 IPC/Renderer 测试先失败后通过；跨模块聚焦回归 9 files / 146 tests 通过。
- 全量门禁：`npm run lint`、`npm run typecheck`、`npm run test:run`（38 files / 282 tests）、`npm run build`、`git diff --check` 均通过。
- 浏览器与桌面门禁：隔离端口 `16121/17184` 的 `npm run e2e` 通过 6/6；`npm run smoke:desktop`、`npm run desktop:test`（1/1）通过。首次使用 `14321` 因 Windows 排除端口 `14301-14400` 返回 `EACCES`，更换端口后通过。
- 发布门禁：补强后的 `CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist`、`node scripts/assert-desktop-artifact.mjs`（107052991 bytes）、`npm run desktop:package:test`（1/1）和 `npm run desktop:installed:test`（安装/快捷方式/安装版流程/卸载）均通过。
- 本轮未 stage、commit 或 push；保留工作区既有未提交改动。Electron-builder 仍提示 `package.json` 缺少 `description`/`author`，遵循既有决定未擅自填写。

## OpenAI-Compatible 模型列表最小实现（2026-08-16）

- 执行方式：subagent-driven development，Tasks 1-6 串行实现并逐项独立复审。
- 工作区策略：当前 `main` 包含本功能依赖的大量未提交桌面实现；已有 Electron worktree 与当前实现不一致，新 worktree 又不会包含该基础。为保留用户改动且遵守不提交约束，本轮在当前工作区执行，并严格限定模型发现相关文件。
- 基线：Node v24.17.0；`npm run lint`、`npm run typecheck`、`npm run test:run`（38 files / 282 tests）通过。
- 计划冲突处理：用户确认强化 Task 5 过期响应测试，等待请求真正结束后再断言旧端点模型未进入列表，避免假通过。
- Task 1: complete (working-tree snapshot review clean; no commit, review Approved)
- Task 1 Minor: shared contract tests do not explicitly assert trim/API-key boundary normalization; schemas implement the required bounds.
- Task 2: complete (working-tree snapshot review clean after fixes; no commit, review Approved)
- Task 2 review fixes: SDK construction and malformed page shape now cross the public error-normalization boundary; focused 9/9 and typecheck pass.
- Task 3: complete (browser route and HTTP transport integrated; no commit)
- Task 4: complete (desktop Vault/IPC/Preload transport integrated; no commit)
- Task 5: complete (dialog-local refresh UI and stale-result ownership integrated; no commit)
- Final review: Approved after adding the SyntaxError -> REQUEST_INVALID regression (focused 10/10)
- Fresh non-release gates: lint, typecheck, build, 40 files / 309 Vitest tests, browser E2E 6/6, desktop smoke, and desktop E2E 1/1 passed
- Task 6: blocked at release artifact generation; electron-builder timed out after 600000ms downloading the official winCodeSign-2.6.0 asset, and a direct official GitHub HEAD probe also timed out
- Existing release artifacts are dated 2026-08-14 and were not used as evidence for this feature; plan checkboxes and design completion status remain unchanged
