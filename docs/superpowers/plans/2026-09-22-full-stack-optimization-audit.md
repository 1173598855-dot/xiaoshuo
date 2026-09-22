# 全栈优化审查记录

日期：2026-09-22

## 审查范围

本轮不把“优化”局限在 Renderer：同时检查了 HTTP Server、SQLite Repository、持久化 Production Worker、Provider/Vault、Electron Main/Preload、桌面打包与安装验收，以及前端沉浸层和构建产物。

## 结果

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
- 本轮进一步把 ThreeBookModel、ProviderDialog、WorkflowDialog、DataManagementDialog、AssetLibraryPanel 和 CommandPalette 改为按需 chunk，首屏主 JS 从约 512KB 降到约 397KB；Three.js 仍只在打开灵感册时加载。
- 本地开发页面默认 favicon 404 仍是站点资源级非阻塞观察，不属于当前业务优化范围。

## 最终门禁

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run test:run`：95 文件、400 测试通过。
- `npm run build` / server smoke：通过。
- `npm run e2e`：7/7 通过。
- `npm run smoke:desktop`：通过。
- `npm run desktop:test`：1/1 通过。
- `npm run desktop:dist` + `node scripts/assert-desktop-artifact.mjs`：通过。
- `npm run desktop:package:test`：1/1 通过。
- `npm run desktop:installed:test`：1/1 通过。
