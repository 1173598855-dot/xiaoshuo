# AI 小说生产链第二轮加固记录

日期：2026-09-12

## 本轮完成

- [x] 候选增加 `runId` 归属，生产详情只读取当前 run 的候选。
- [x] HTTP 和 Electron 的恢复命令立即返回，长任务在后台继续。
- [x] 轮询改为单飞请求，慢请求不会被下一次轮询自我取消。
- [x] Markdown 与 TXT 导出区分；DOCX 未实现时返回明确错误，不生成伪 DOCX 文件。
- [x] 修正客户端测试 fixture，使其符合候选共享契约。

## 验证

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`：43 个测试文件，181 项测试
- `npm run build`
- `npm run e2e`：4 passed
- `npm run smoke:desktop`
- `npm run desktop:test`：1 passed
- `npm run desktop:dist`
- `node scripts/assert-desktop-artifact.mjs`
- `npm run desktop:package:test`：1 passed
