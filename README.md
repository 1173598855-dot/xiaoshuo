# 小奕小说生成工具

小奕是一个本地优先的长篇小说创作工作台。它把章节编辑、版本追踪和多模型生成放在同一条可审计流程中：模型先生成候选文本，作者明确采纳后才写入正文。

## 当前阶段

项目正在实现第一个可运行闭环：

1. 创建并编辑小说章节；
2. 自动保存并保留线性版本；
3. 通过 OpenAI、Anthropic、Google Gemini 或 OpenAI-compatible 端点生成候选；
4. 预览、丢弃或显式采纳候选；
5. 记录生成时使用的章节 revision、模型和提示信息。

设计规格见 `docs/superpowers/specs/2026-08-03-local-writing-workbench-design.md`，执行计划见 `docs/superpowers/plans/2026-08-03-local-writing-workbench.md`。

## 核心原则

- 正文和作者确认的正典是事实源，AI 记忆只能由它们派生。
- 生成结果在采纳前不得修改正文。
- 每次保存和采纳都使用 revision 比较，避免并发覆盖。
- API Key 不写入项目数据库或日志；首版只保存在浏览器会话内。
- 原生厂商适配器优先，OpenAI-compatible 自定义端点作为扩展通道。

## 技术方向

- React + TypeScript + Vite
- Hono Node 服务
- Node 24 内置 `node:sqlite`
- Zod 共享契约
- Vitest + Playwright

安装、运行和测试命令会在首个实现任务完成后补充。
