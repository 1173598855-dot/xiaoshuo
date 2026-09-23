# 2026-09-24 全栈性能与维护优化

## 目标与边界

在不改变作者工作流、HTTP/IPC 业务结果和持久化规则的前提下，降低首页加载成本、长篇生产期间的重复读取、空闲数据库写锁和客户端长文轮询传输。Provider 密钥仍只在 Main/Vault 与当前请求内存中使用；候选与正式正文的隔离、revision 校验和原子采纳保持不变。

## 基线

- 本轮开始前的 Vite 入口：420.2 KB（gzip 119.7 KB）；全局 CSS：209.1 KB（gzip 35.3 KB）。
- Three.js 已是动态 chunk，不进入首页静态 modulepreload。
- 初始工作区干净，基线提交为 `8941eaa chore: prepare v0.4.0 release`。

## 实施

- [x] 将方向页、生产室、候选审核及按需工具面板拆为动态 chunk；关闭的 Provider、工作流、数据和快捷操作面板不预先挂载。
- [x] 章节目录预先建立已采纳章节位置 Set，保留从 1-based 章号到 0-based position 的映射。
- [x] ProviderVault 在单次工作流解析中复用一次 settings 与加密 Vault 快照，不跨调用缓存。
- [x] 修订时间线用复合键 Map 关联批注，保持同键最新批注优先。
- [x] 生产每章只读 Book 摘要和下一条章纲；只有无待生产章纲时才读完整作品详情。
- [x] Worker 在恢复过期 lease 和领取任务前先做只读存在性检查；空闲时不再为这两项工作开启 `BEGIN IMMEDIATE`。
- [x] 增加单 run 轻量摘要的 HTTP 与白名单 IPC；轮询时仅在 run 版本变化后重新载入完整候选与正文，心跳变化只合并队列状态。
- [x] 修正开发说明中已不存在的 `src/server/app.ts` 路径。

## 结果

- 最终首页入口为 313.62 KB（gzip 93.72 KB）：比基线少 106.58 KB / 25.98 KB gzip，约下降 25.4% / 21.7%。初始 CSS 为 194.23 KB（gzip 33.29 KB），较基线少 14.87 KB / 2.01 KB gzip。生产室、审核和工具面板由独立动态 chunk 提供。
- 四角色工作流解析中的 settings 读取由最多 5 次降为 1 次，Vault 解密由最多 4 次降为 1 次；后续解析仍即时读取新设置与凭据撤销。
- 修订批注关联从时间线项与批注的重复线性搜索改为 O(notes + items)；相同 scope/entity/revision 继续使用最新批注。
- 两章生产测试中，逐章 full `getBook` 调用由 3 次降为 1 次；每章改用仅解析书籍记录的摘要读取。
- 无过期/可领取任务的 Worker 轮询不会进入恢复或领取写事务；实际可运行任务仍由事务内再次查询和原子 lease claim 保护。
- 生产轮询保留 1 秒轻量摘要与心跳显示；版本没变化时不再重复传输全部候选历史和正式章节正文。摘要继续剔除 `leaseToken`。

## 验证

- 全仓门禁通过：`npm run lint`、`npm run typecheck`、`npm run test:run`（102 个文件 / 438 项）、`npm run build`（含 server smoke）、`npm run e2e`（9/9）、`npm run e2e:auth`（2/2）、`npm run smoke:desktop`、`npm run desktop:test`（1/1）。
- 针对性验证也通过：ProviderVault 28 项；ProductionWorker + queue 17 项；HTTP / IPC / 轮询摘要路径 32 项。
- 首次打开动态页面或面板会显示现有 Suspense 加载提示。
- 暂停状态下尚未确认的记忆审阅修改不会经跨窗口摘要轮询实时同步；当前作者操作仍有本地状态/显式刷新，恢复生产后会刷新完整详情。
- Vite 仍会提示 527.81 KB 的 Three.js chunk 超过 500 KB；该 chunk 延迟到灵感册交互时加载，不属于首页静态入口。
- 本轮不是桌面发布，不运行会覆盖 `release/XiaoyiNovelWorkbench-0.4.0-setup.exe` 的 `desktop:dist`。
