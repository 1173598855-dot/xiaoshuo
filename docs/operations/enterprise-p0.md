# 企业内网 P0 运行说明

本版本的企业边界是**单用户 / 单租户作者工作台**，不包含多人协作、实时编辑、多租户和云端协作。SQLite 仍是有意保留的本地优先存储；服务通过持久化 run、单进程队列和安全恢复脚本保证可运营性。

## 启动配置

生产环境必须设置至少 16 位的 `XIAOYI_ACCESS_TOKEN`。除健康探针外，所有 HTTP API 和运维接口都要求：

```http
Authorization: Bearer <XIAOYI_ACCESS_TOKEN>
```

需要限制注册人数时，额外设置 `XIAOYI_INVITATIONS_REQUIRED=1`。管理员令牌必须同时配置；作者必须先通过邀请码注册账号，再使用用户名和密码登录；账号只能访问自己的作品。注册用户在浏览器模型设置中自行填写 Provider 和 API Key，管理员不需要代为提供用户模型 Key。邀请码的 `maxUses` 是注册次数硬上限，撤销邀请码不会影响已经注册的账号。

最小启动示例：

```powershell
$env:NODE_ENV = "production"
$env:XIAOYI_ACCESS_TOKEN = "replace-with-a-long-random-token"
$env:XIAOYI_HOST = "127.0.0.1"
$env:XIAOYI_DATABASE_PATH = "C:\ProgramData\Xiaoyi\xiaoyi.db"
$env:XIAOYI_BACKUP_DIR = "C:\ProgramData\Xiaoyi\backups"
npm start
```

容器部署需要显式设置 `XIAOYI_ACCESS_TOKEN`；`Dockerfile` 默认监听 `0.0.0.0`。仓库提供了带 Nginx 反向代理的 Compose 闭环，代理只暴露一个同源入口，应用容器只加入内部网络：

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少替换 XIAOYI_ACCESS_TOKEN
npm run docker:up
Invoke-WebRequest http://127.0.0.1:8080/api/health
npm run docker:status
```

入口端口可由 `XIAOYI_HTTP_PORT` 覆盖。`app` 服务将 SQLite、WAL sidecar 和备份写入命名卷 `xiaoyi-novel-workbench-data`；需要迁移或备份到主机时，可将 `XIAOYI_DATA_VOLUME` 改成运维平台管理的卷名。查看日志、停止服务和重建镜像：

```powershell
npm run docker:logs
npm run docker:down
npm run docker:build
```

默认 HTTP 发布只绑定 `127.0.0.1`。公网 HTTPS 可直接用内置 Nginx TLS profile：将完整证书链放到 `deploy/tls/fullchain.pem`、私钥放到 `deploy/tls/privkey.pem`（目录和文件已加入 Git/Docker 忽略），在 `.env` 中设置公开的 `XIAOYI_ALLOWED_ORIGIN=https://writer.example.com`，然后运行：

```powershell
npm run docker:up:https
```

TLS profile 默认发布 443，并通过内部 Docker 网络代理到 app；HTTP 入口仍只绑定 loopback。修改证书后运行 `npm run docker:restart:https`。生产上游 HTTPS 若在 443 以外端口，allowed origin 需要带端口。

`XIAOYI_STATIC_DIR` 默认指向镜像内的 `/app/dist/client`。Node 服务会在同一端口提供 Vite 构建产物和 SPA fallback，`/api/*` 始终优先走 JSON API；Nginx 只做同源转发，不缓存 API 响应。

可选运维配置：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `XIAOYI_MAX_CONCURRENT_RUNS` | `1` | 生产 run 并发上限；队列状态会持久化为 `queued` |
| `XIAOYI_RATE_LIMIT_PER_MINUTE` | `120` | 单租户访问令牌/IP 的 API 滑动窗口限流 |
| `XIAOYI_ALLOWED_ORIGIN` | 不限制 | 浏览器 CORS 来源白名单 |
| `XIAOYI_INVITATIONS_REQUIRED` | `0` | 是否要求作者先使用邀请码注册并登录 |
| `XIAOYI_AUTH_SESSION_DAYS` | `7` | 账号会话有效天数，范围 1–90 |
| `XIAOYI_HTTP_PORT` | `8080`（Compose） | Nginx 对外监听端口；直连 Node 时不生效 |
| `XIAOYI_HTTP_BIND` | `127.0.0.1`（Compose） | 本地 HTTP 代理的宿主绑定地址；只有主动配置 `0.0.0.0` 时才暴露给局域网 |
| `XIAOYI_HTTPS_PORT` | `443` | 可选 HTTPS Nginx profile 的宿主端口 |
| `XIAOYI_STATIC_DIR` | `dist/client`（镜像为 `/app/dist/client`） | 已构建 Renderer 静态文件目录 |
| `XIAOYI_TRUST_PROXY` | `0` | 仅在可信反向代理后设为 `1`，启用代理 IP 识别 |
| `XIAOYI_REMOTE_BACKUP_DIR` | 未配置 | 已挂载的 NAS/网络盘备份目录；写入后会再次完整性校验 |
| `XIAOYI_BACKUP_INTERVAL_MINUTES` | `60` | 定时备份间隔 |
| `XIAOYI_BACKUP_RETENTION` | `30` | 本地和远程各自保留的副本数 |
| `XIAOYI_MONTHLY_TOKEN_LIMIT` | 不限制 | 当前 UTC 月输入+输出 token 上限 |
| `XIAOYI_MONTHLY_BUDGET_MICROS` | 不限制 | 当前 UTC 月成本上限，单位为配置货币的百万分之一 |
| `XIAOYI_MODEL_PRICING_JSON` | `{}` | 模型价格表，键为 `kind:model`，值为 `{inputPerMillionMicros,outputPerMillionMicros}` |
| `XIAOYI_FALLBACK_PROVIDERS_JSON` | `[]` | 最多 3 个备用 Provider 配置，只对限流/上游不可用自动切换 |
| `XIAOYI_SERVER_PROVIDERS_JSON` | `[]` | 服务端 Worker 使用的 Provider 配置数组；只驻留内存，API Key 不写 SQLite/日志/响应 |
| `XIAOYI_ALERT_WEBHOOK_URL` | 未配置 | 可选 HTTPS 告警 Webhook；仅发送归一化指标事件 |
| `XIAOYI_AUDIT_RETENTION_DAYS` | `180` | 审计事件保留天数，后台定期清理 |
| `XIAOYI_USAGE_RETENTION_DAYS` | `365` | 用量事件保留天数，后台定期清理 |

Provider 密钥只能通过部署环境的 Secret 注入 `XIAOYI_SERVER_PROVIDERS_JSON` / `XIAOYI_FALLBACK_PROVIDERS_JSON`，不要提交到仓库或日志。生产 Worker 只把 kind/model/baseUrl 描述写入 run，重启后从这组内存配置恢复。桌面端密钥继续由 Windows DPAPI `safeStorage` Vault 管理；保存新 Key 会生成新 credential 并吊销旧 credential。

## 健康检查和监控

- `GET /api/health`：存活探针，不要求令牌；只返回服务存活状态。
- `GET /api/ready`：就绪探针，不要求令牌；只返回 SQLite 与 Worker 是否就绪，不返回队列数量、备份时间或文件路径。
- `POST /api/auth/register`：使用邀请码注册账号并创建会话；`POST /api/auth/login`：账号登录；`POST /api/auth/logout`：撤销当前会话。
- `GET /api/metrics`：Prometheus 文本指标，需要令牌。
- `GET /api/admin/metrics`：JSON 指标、队列状态和当月用量，需要令牌。
- `GET /api/admin/runs`：按状态、作品、失败码和更新时间游标搜索生产 run，返回重试与租约摘要，需要令牌。
- `GET /api/admin/providers`：只返回服务端 Provider 元数据与 `hasApiKey`，不返回密钥，需要令牌。
- `GET /api/admin/providers/:index/models` 和 `POST /api/admin/providers/:index/test`：使用已注入服务端 Secret 拉取模型列表/测试连接，响应不含密钥。
- `GET /api/openapi.json`：OpenAPI 3.1 路由索引，需要令牌。
- `GET /api/admin/audit`：请求、生产 run 和失败状态审计记录，需要令牌。
- 结构化日志使用 JSON Lines；不会写入请求正文、提示词、Authorization、API Key 或密码。

告警默认写入结构化日志：HTTP 5xx、Provider 调用失败和备份失败会触发告警事件，并按冷却窗口去重。部署时将 stdout/stderr 接入现有日志平台即可。

设置 `XIAOYI_ALERT_WEBHOOK_URL` 后，告警会以 JSON POST 发送到该 HTTPS 地址；发送失败只记录脱敏事件，不会阻塞生成或备份。审计和用量表按保留天数定期清理，也可以在停机前通过数据库备份保留归档副本。

## 备份与恢复

定时备份使用 SQLite 原子备份 API，写入临时文件后执行 `PRAGMA integrity_check` 和 schema 检查，再原子改名。设置 `XIAOYI_REMOTE_BACKUP_DIR` 后，远程副本会复制并再次校验，校验失败不会被视为成功备份。

手动备份和验证：

```powershell
curl.exe -H "Authorization: Bearer $env:XIAOYI_ACCESS_TOKEN" -X POST http://127.0.0.1:4310/api/admin/backups
npm run backup:verify -- C:\ProgramData\Xiaoyi\backups\xiaoyi-backup-<timestamp>.db
```

恢复前必须停止服务，确认目标数据库不存在 `-wal` / `-shm` 活动 sidecar：

```powershell
npm run backup:restore -- C:\ProgramData\Xiaoyi\backups\xiaoyi-backup-<timestamp>.db C:\ProgramData\Xiaoyi\xiaoyi.db --offline
npm start
```

恢复脚本会先校验源副本和临时目标；替换失败时保留并恢复旧目标。至少每月在隔离目录执行一次验证恢复演练，并记录 RPO/RTO 结果。

## 升级与回滚

1. 发布前运行全部质量门禁和 `npm run security:dependencies`。
2. 先创建并验证一份手动备份。
3. 安装新版本；数据库迁移在事务中完成。
4. 观察 `/api/ready`、`/api/metrics` 和审计日志。
5. 若迁移或运行异常，停止服务，使用已验证副本执行 `npm run backup:restore`，再安装上一版并启动。
6. Windows 安装包采用版本化文件名；GitHub tag 发布流程会生成对应 NSIS 安装包，保留上一版本安装包用于回滚。
