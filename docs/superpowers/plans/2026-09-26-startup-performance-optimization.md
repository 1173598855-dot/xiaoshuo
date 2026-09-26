# 2026-09-26 全栈性能优化

## 目标与边界

降低数据库随作品规模增长后的桌面启动与候选采纳成本，不改变作者工作流、数据库数据、候选历史、revision、备份/恢复事务或凭据边界。

## 实施

### E1 桌面启动完整性扫描去重

- [x] 对已有数据库保留迁移前的全库 `integrity_check` 与迁移前 schema 支持检查。
- [x] 记录迁移前完整性检查已完成后，跳过 `verifyRuntime` 中重复的全库扫描；迁移后的 canonical schema 和工作区校验仍执行。
- [x] 首次启动、恢复、导入和其它 runtime 验证路径继续执行完整性检查。

### S1 候选文本历史一次性补写

- [x] 将 `auto_novel_schema_version` 升至 6。
- [x] 仅在旧版或无效版本数据库上查找并补写缺少 revision 0 的候选文本历史。
- [x] 补写与版本标记继续处于既有迁移事务内；运行时新候选的历史记录路径保持不变。

### S2 候选采纳质量门禁读取复用

- [x] `qualityGate()` 只加载一次作品详情，并将其用于一致性分析与章纲标题检查。
- [x] accept 事务移除未使用的完整作品详情读取和 `project_id` 查询；新鲜质量门禁、候选校验、revision/context 检查和正文写入仍在同一事务。
- [x] 为质量门禁的单次作品读取增加回归覆盖。

## 验证

- [x] `npm run typecheck`。
- [x] `npm run lint`。
- [x] `git diff --check`。
- [x] `npm run test:run`（108 个测试文件 / 494 项通过），含旧版候选历史补写、版本门控、单次质量门禁读取、已有库/首次启动完整性扫描及损坏库启动拒绝回归。
- [x] `npm run build`（含 server smoke）和 `npm run e2e`（10/10）。
- [x] `npm run e2e:auth`（2/2）、`npm run smoke:desktop` 与 `npm run desktop:test`（1/1）。

## 后续候选

- `getRunDetails()` 会在生产 run 版本变化时重载累计的检查点、候选文本和已采纳正文；可单独设计按需加载/增量 DTO，避免把传输契约改动混入启动优化。
- 桌面端 run 摘要 IPC 目前未透传 HTTP 适配器支持的状态筛选和 limit 参数；应单独修复跨端列表一致性。
- 加密导出以整库 Buffer 处理；若大数据库导出成为常见场景，再评估保持 V1 解密兼容的流式格式。
