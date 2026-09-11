# AI 小说生产链可靠性加固记录

日期：2026-09-11

## 本轮完成

- [x] 同一生产 run 在同一服务实例内单飞，避免重复模型调用和重复候选。
- [x] 暂停、取消和数据库关闭会中止/等待活动生产任务；控制状态不会被后续阶段覆盖。
- [x] 暂停后恢复会复用当前章节未结算候选，不重新生成草稿。
- [x] 开书请求按幂等键复用同一本书，导演阶段记录 run 和 checkpoint。
- [x] 基础设定阶段记录 foundation/outline run 和 checkpoint；无章纲时禁止把生产任务标记为完成。
- [x] 方向生成完成后正确更新 `directions-ready` 状态。
- [x] 书籍详情只把 `production` run 暴露为正文生产进度，避免阶段 run 误触发已完成 UI。
- [x] 桌面自动小说服务按活动数据库运行时缓存，关闭/维护前等待活动任务结束。

## 验证

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`：38 个测试文件，175 项测试
- `npm run build`
- `npm run e2e`：4 passed
- `npm run smoke:desktop`
- `npm run desktop:test`：1 passed

## 下一批

- 为候选增加 `runId`/checkpoint 归属并按 run 隔离查询。
- 进度接口拆分摘要、当前候选和分页正文；轮询改为单飞与退避。
- 将恢复接口改为立即返回的后台命令，并补齐导演/基础设定的显式恢复 UI。
- 实现真正的 TXT/DOCX 导出序列化。
