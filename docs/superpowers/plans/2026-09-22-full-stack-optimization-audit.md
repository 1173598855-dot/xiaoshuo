# 全栈优化审查记录

日期：2026-09-22

## 审查范围

本轮不把“优化”局限在 Renderer：同时检查了 HTTP Server、SQLite Repository、持久化 Production Worker、Provider/Vault、Electron Main/Preload、桌面打包与安装验收，以及前端沉浸层和构建产物。

## 结果

### 作者交付闭环

- 正文导出前预检复用一致性接口和当前章节/章纲投影，展示缺失章节、空章节和高优先级冲突后再进入 DOCX/ePub 导出。
- 正文章节批注/书签只保存在当前浏览器本地，不进入正文、SQLite 或 Provider 请求。
- 创作中枢上下文回放只记录记忆 revision、上下文 Hash、章节、作者工作区 revision、启用 Prompt 名称和配方名称，不保存 Provider 凭据。
- 系统健康面板复用服务 ready、用量、作品一致性和桌面数据库状态，失败时只显示归一化错误。
- 业务下拉统一迁移到可访问的 `ThemeSelect` listbox：菜单通过 portal 定位，绕开 Windows/Chromium 原生白色弹层，统一深色 surface、紫色 focus、键盘导航、Escape 回收和 reduced-motion；真实 Chromium E2E 会打开菜单并断言主题背景。
- 复查截图反馈后补齐 `.memory-drawer`、审核候选、记忆变更和 `.manuscript-page` 的深色 surface/文字对比度；真实 Chromium 渲染检查确认记忆卡与审核正文的背景为 `#211f2e`、正文文字为 `#f4f2fb`。
- 新增作者交付中心作为六项能力的统一入口：发布资料/manifest、质量门禁、修订时间线、成本配额、快照选择性章纲合并和本地自动化规则；发布配置、预算和规则隔离在本地交付层，不污染 AI workspace revision。
- 导出路径新增服务端质量 guard，错误级一致性问题在 UI 之外也返回稳定 409；用量聚合增加 Provider/模型维度，时间线补入正式章节与记忆 revision。
- 第二阶段深化把作者交付资料/预算/自动化规则写入独立 SQLite state revision；质量门禁现在由 `AuthoringService.qualityGate` 统一提供，accept、导出和自动化协调器共享同一阻断结果。
- 用量事件增加作品、章节、生产阶段 attribution；`UsageRepository.reserveQuota` 使用 SQLite 写锁预留 Token/费用，Provider 调用结束后原子结算/释放，并向公共契约暴露 byBook/byChapter/byStage 与 quota snapshot。
- `RevisionRepository` 从 story snapshot、chapter revision、memory revision、candidate text revision 组装服务端权威时间线，提供逐行 Diff、expected revision 恢复和 snapshot 选择性合并；候选文本历史不再只依赖 Renderer 的局部投影。
- `AutomationCoordinator` 只执行固定枚举规则：生成后质检、accept commit 后 verified backup、导出前 fresh quality check；每次执行都有 SQLite 幂等键，失败不会回滚已经提交的正文，也不会执行任意脚本或外链。

### Server / SQLite

- Repository 的 chapter、memory、authoring workspace 和 candidate 写入继续使用 expected revision、事务和历史快照。
- Production Worker 继续使用 SQLite lease、heartbeat、过期恢复、重试上限和停止时的 fencing；没有发现需要为了视觉需求冒险修改的并发边界。
- Backup/retention/observability 已有独立服务、失败告警、保留策略和指标；指标采样有上限，避免长期运行中的无界增长。
- HTTP body limit、访问令牌、来源校验、速率限制和未知错误归一化保持不变。

### Electron / 发布

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 和 IPC sender 校验保持通过。
- ProviderVault 继续 Main-only；safeStorage 不可用时只退化到当前 Main 会话内存。
- 桌面 E2E 暴露了两个可维护性问题：生产状态汇总条与保存提示共用 `role=status`，以及多个“记忆中心”按钮导致严格定位歧义；已分别改为命名 live region 和章节上下文内定位。
- NSIS 安装包、打包应用和安装后验收均通过。

### 依赖与构建

- `npm run security:dependencies`：0 high/critical vulnerabilities。
- Vite 仍报告主 bundle 和 Three.js chunk 超过 500KB；这是已有的前端拆包优化项，不影响功能或发布验证，Three.js 已在交互打开后动态加载。
- 本轮进一步把 ThreeBookModel、ProviderDialog、WorkflowDialog、DataManagementDialog、AssetLibraryPanel、AuthorDeliveryCenterPanel 和 CommandPalette 改为按需 chunk，首屏主 JS 当前约 412KB；Three.js 仍只在打开灵感册时加载。
- 本地开发页面默认 favicon 404 仍是站点资源级非阻塞观察，不属于当前业务优化范围。
- 六项深化继续沿用首屏 lazy chunk、Three.js 延迟加载、ThemeSelect 键盘/焦点/对比度、移动端视口和 reduced-motion 约束，没有把质量/备份/配额逻辑重新放回 Renderer。

## 最终门禁

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run test:run`：102 文件、413 测试通过。
- `npm run build` / server smoke：通过。
- `npm run e2e`：8/8 通过（含主题化下拉的真实菜单打开与背景断言）。
- `npm run smoke:desktop`：通过。
- `npm run desktop:test`：1/1 通过。
- `npm run desktop:dist` + `node scripts/assert-desktop-artifact.mjs`：通过。
- `npm run desktop:package:test`：1/1 通过。
- `npm run desktop:installed:test`：1/1 通过。

第二阶段收口证据：新增配额预留、自动化幂等、作者交付持久化和权威修订仓储测试；`npm run e2e`：8/8 通过；`npm run security:dependencies`：0 vulnerabilities；主入口 JS 为 418.25KB，相对 412KB 基线增长约 1.5%，低于 5% 门槛。
