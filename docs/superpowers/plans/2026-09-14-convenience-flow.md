# AI 小说最便捷创作链实施计划

日期：2026-09-14

## 目标

在不改变“候选先审后采纳、revision 乐观锁、本地优先”的前提下，把首次配置到开始写作的关键路径压缩为：

```text
配置 Provider → 测试连接 / 自动选模型 → 输入想法 → 一键开写 → 自动恢复 → 正文导出
```

## 范围边界

- 保留 HTTP 与 Electron 两套窄边界，不把 API Key 写入 SQLite、日志、候选、备份、导出或 Renderer 返回值；
- 兼容端点只允许 HTTPS 或 loopback HTTP；固定 Provider 始终使用目录中的端点；
- 一键开写只自动选择 rank 1 方向，仍保留手动选择三方向的路径；
- 恢复只处理已持久化的 queued/running 生产任务，paused/failed 由作者显式继续或重试；
- 不引入账号、云同步、多用户、向量库或多章并行。

## 交付清单

- [x] Provider 一键连接测试：HTTP `/api/providers/test` 与 Electron `provider:test-connection`，只返回模型和延迟；
- [x] 自动选模型：兼容端点获取模型列表，静态目录优先、动态列表兜底；空模型时点击测试连接会先选模型再测试；
- [x] 会话/Vault 只在同一 Provider 和有效端点下复用 Key，固定端点不允许覆盖；
- [x] 首页“一键开写”：输入一句想法后自动选择第一方向、生成基础设定与章纲并启动生产；
- [x] 启动恢复：扫描已选方向作品，自动恢复 queued/running 任务；paused/failed 进入生产室等待作者处理；
- [x] 失败阶段重试：生产室支持从当前检查点重试，基础设定失败可重新执行同一方向；
- [x] 创作预设：悬疑短篇、都市连载、东方幻想会把题材、章节规模和文风传入提示词；
- [x] 当前章节 AI 重写：重写结果创建隔离候选，仍须审核、记忆确认和原子 accept；
- [x] 正式正文搜索、目录以及 Markdown/TXT/DOCX 导出；DOCX 使用最小 OOXML ZIP，排除 revision 为 0 的占位章节；
- [x] 导入后清理旧导航状态，并在 Provider Key 清除后同步 Renderer 设置摘要；
- [x] 为连接测试、空模型自动选择、Vault 固定端点、生产 run 去重、重写候选、一键开写和 DOCX 接口补充回归覆盖。

## 验证门禁

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:run`（54 个测试文件，234 项测试）
- [x] `npm run build`
- [x] 隔离端口 `npm run e2e`（4 passed）
- [x] `npm run smoke:desktop`
- [x] `npm run desktop:test`（1 passed）
- [x] `npm run desktop:dist`
- [x] `node scripts/assert-desktop-artifact.mjs`
- [x] `npm run desktop:package:test`（1 passed）
- [x] `git diff --check`
