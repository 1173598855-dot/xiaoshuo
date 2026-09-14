# 单实例服务器 P0/P1 运营闭环实施记录

日期：2026-09-14

## 范围

- 保持单实例、单用户/单租户与 SQLite；不引入多用户、多租户、多副本或 Kubernetes。
- Worker 只持久化 Provider kind/model/baseUrl 描述，凭据由进程 Secret 配置解析。
- 正文候选、章节 revision、记忆审阅和 accept 事务语义保持不变。

## 实施清单

- [x] 为 production run 增加无密钥 Provider 描述、重试策略、下次执行时间、Worker 租约与 heartbeat 迁移。
- [x] 增加持久化 Worker：启动扫描 queued 与过期 running，单 run 原子租约、heartbeat、租约 fencing、指数退避、最大重试、永久失败、卡死回收与优雅停机。
- [x] 将生产 HTTP 启动/恢复路由接到 Worker；未启动 Worker 时仍保留旧测试/桌面服务路径。
- [x] 仅在 lease 持有期间允许 Worker 修改 run、候选、checkpoint、章节 accept 和作品状态；accept 检查与正文/记忆事务保持原子。
- [x] 增加 `XIAOYI_SERVER_PROVIDERS_JSON` 服务端 Secret 注入、无密钥配置摘要、服务端 Provider 测试连接与模型列表路由。
- [x] 保留限流/上游错误的备用 Provider 故障转移；新增 OpenAPI、run 搜索、用量/审计保留策略、HTTPS 告警 Webhook。
- [x] 增加请求体限制、安全响应头、运维路由 fail-closed 鉴权、就绪探针最小化与有限基数的运维指标。
- [x] 提供一体化多阶段 Docker 镜像、Node 静态前端/SPA fallback、Compose + Nginx 同源代理、命名数据卷、探针、日志轮转、部署脚本和 `.env.example`。
- [x] 默认 HTTP proxy loopback 绑定；补可选 Nginx TLS profile、证书 secret 挂载和启动前校验。
- [x] 将本地数据库备份、SQLite sidecar、Secret 文件和 runtime artifacts 排除出 Git/Docker 构建上下文。
- [x] 浏览器增加退避轮询、网络/焦点恢复与 runId 切换隔离。

## 验证

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:run`：68 files、282 tests passed
- [x] `npm run build`（包含 server smoke）
- [x] `npm run security:dependencies`：生产依赖 0 vulnerabilities
- [x] `npm run e2e:external`：4/4（以手动启动的隔离 API/Vite 服务执行）
- [x] `npm run smoke:desktop`
- [x] `npm run desktop:test`
- [x] `npm run desktop:dist`
- [x] `node scripts/assert-desktop-artifact.mjs`
- [x] `npm run desktop:package:test`
- [x] `npm run desktop:installed:test`
- [x] `docker compose -f compose.yaml config --quiet`
- [x] `docker compose build app`：Node 24 multi-stage 镜像构建成功；构建上下文 2.22 MB；生产依赖审计 0 vulnerabilities。
- [x] 隔离 Compose 集成演练：app/Nginx 健康，首页与 `/api/ready` 可用，Bearer 鉴权生效；通过 deterministic Provider 创建作品并采纳 3 章，重启 app 后数据仍在命名卷中。
- [x] TLS profile 集成演练：临时自签证书下 HTTPS 首页与 health probe 均为 200，app 和双代理 healthcheck healthy；验证后移除专用验证卷与临时证书。

默认 `npm run e2e` 的 Playwright `webServer` 子进程在本机 127.0.0.1 监听超时；直接手动启动 API/Vite 后，`npm run e2e:external` 的完整流程及三个视口全部通过。
