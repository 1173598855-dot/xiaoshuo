# 2026-09-25 全源码审查与优化

## 审查范围

围绕 `src/` 中客户端、共享 Zod 契约、HTTP 路由、Provider/用量、SQLite repository/备份，以及 Electron Main/Preload/IPC 与生命周期进行全链路审查；并扫描测试和 E2E 入口、TODO/FIXME、动态 HTML/执行和敏感字段日志路径。

## 发现与修复

- **限流器热路径**：原实现每个请求都扫描所有身份，key 达到 10,000 上限时还排序全量记录。现在只过滤当前 key 的滑动窗口记录，身份满额时用 Map 顺序 O(1) 淘汰 LRU。
- **本地构思续写**：首页原先只说明草稿会保存，没有直接恢复入口；返回首页时可能早于 React 被动 effect 的清理读取草稿。现在首页显示本地草稿字数并可直接继续，输入/预设/火花/资产带入立即落盘，首页不展示故事正文。
- **Provider 重试放大**：OpenAI、Anthropic、OpenAI-compatible 和 Google SDK 内部重试会叠加应用层的 Provider fallback 与生产重试。现在关闭 SDK 隐式重试，保留应用层有界策略，Google 请求设置为单次尝试。
- **超时错误分类**：服务端阶段 timeout 会 abort Provider signal，过去因此被规范化成 `REQUEST_ABORTED`。现在内部 timeout 记为 `UPSTREAM_UNAVAILABLE`，调用方主动取消仍为 `REQUEST_ABORTED`，Worker 可按上游故障处理。
- **灵感册首屏负担**：折叠的灵感册仍会挂载 Three.js 画布并请求大型模块。现在只有作者打开书册才挂载 3D 画布；Three.js chunk 保留为按需功能的独立资源。
- **构建提示**：Three.js vendor chunk 仍较大，但现在只随作者显式打开灵感册时加载；常规首页/创作页不请求它，这是目前保留的按需资源体积项。

## 边界复核

- 未新增数据库表、API/IPC 字段或公共 DTO；限流器、Provider 重试和 timeout 分类都留在既有边界。
- 正文依旧只在候选被作者 accept 后写入；expected revision、generation base revision 和候选隔离语义不变。
- Provider 密钥仍由会话内存或 Main/Vault 管理；无动态 HTML 注入或 Renderer Node 能力新增。

## 验收记录

- [x] lint、typecheck、依赖审计（0 漏洞）与完整单测（107 个文件 / 489 项通过）
- [x] build/server smoke、Web E2E（10 项）、auth E2E（2 项）、桌面 smoke 与 Electron E2E（1 项）
- [x] 三视口检查（1440x960、1024x768、390x844）；限流器 LRU、超时分类、草稿续写和 Three.js 延迟挂载均有回归覆盖
- [ ] 最终 diff 复核和 GitHub 推送
