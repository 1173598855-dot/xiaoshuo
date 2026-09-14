# 企业内网 P0 运行说明

本版本的企业边界是**单用户 / 单租户作者工作台**，不包含多人协作、实时编辑、多租户和云端协作。SQLite 仍是有意保留的本地优先存储；服务通过持久化 run、单进程队列和安全恢复脚本保证可运营性。

## 启动配置

生产环境必须设置至少 16 位的 `XIAOYI_ACCESS_TOKEN`。除健康探针外，所有 HTTP API 和运维接口都要求：

```http
Authorization: Bearer <XIAOYI_ACCESS_TOKEN>
```

最小启动示例：

```powershell
$env:NODE_ENV = "production"
$env:XIAOYI_ACCESS_TOKEN = "replace-with-a-long-random-token"
$env:XIAOYI_HOST = "127.0.0.1"
$env:XIAOYI_DATABASE_PATH = "C:\ProgramData\Xiaoyi\xiaoyi.db"
$env:XIAOYI_BACKUP_DIR = "C:\ProgramData\Xiaoyi\backups"
npm start
```

容器部署需要显式设置 `XIAOYI_ACCESS_TOKEN`；`Dockerfile` 默认监听 `0.0.0.0`，必须通过内网防火墙或反向代理限制访问。

可选运维配置：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `XIAOYI_MAX_CONCURRENT_RUNS` | `1` | 生产 run 并发上限；队列状态会持久化为 `queued` |
| `XIAOYI_RATE_LIMIT_PER_MINUTE` | `120` | 单租户访问令牌/IP 的 API 滑动窗口限流 |
| `XIAOYI_ALLOWED_ORIGIN` | 不限制 | 浏览器 CORS 来源白名单 |
| `XIAOYI_TRUST_PROXY` | `0` | 仅在可信反向代理后设为 `1`，启用代理 IP 识别 |
| `XIAOYI_REMOTE_BACKUP_DIR` | 未配置 | 已挂载的 NAS/网络盘备份目录；写入后会再次完整性校验 |
| `XIAOYI_BACKUP_INTERVAL_MINUTES` | `60` | 定时备份间隔 |
| `XIAOYI_BACKUP_RETENTION` | `30` | 本地和远程各自保留的副本数 |
| `XIAOYI_MONTHLY_TOKEN_LIMIT` | 不限制 | 当前 UTC 月输入+输出 token 上限 |
| `XIAOYI_MONTHLY_BUDGET_MICROS` | 不限制 | 当前 UTC 月成本上限，单位为配置货币的百万分之一 |
| `XIAOYI_MODEL_PRICING_JSON` | `{}` | 模型价格表，键为 `kind:model`，值为 `{inputPerMillionMicros,outputPerMillionMicros}` |
| `XIAOYI_FALLBACK_PROVIDERS_JSON` | `[]` | 最多 3 个备用 Provider 配置，只对限流/上游不可用自动切换 |

Provider 密钥只能通过部署环境的 Secret 注入 `XIAOYI_FALLBACK_PROVIDERS_JSON`，不要提交到仓库或日志。桌面端密钥继续由 Windows DPAPI `safeStorage` Vault 管理；保存新 Key 会生成新 credential 并吊销旧 credential。

## 健康检查和监控

- `GET /api/health`：存活探针，不要求令牌；只返回服务存活状态。
- `GET /api/ready`：就绪探针，不要求令牌；检查 SQLite 可读性、队列和备份状态，不返回文件路径。
- `GET /api/metrics`：Prometheus 文本指标，需要令牌。
- `GET /api/admin/metrics`：JSON 指标、队列状态和当月用量，需要令牌。
- `GET /api/admin/audit`：请求、生产 run 和失败状态审计记录，需要令牌。
- 结构化日志使用 JSON Lines；不会写入请求正文、提示词、Authorization、API Key 或密码。

告警默认写入结构化日志：HTTP 5xx、Provider 调用失败和备份失败会触发告警事件，并按冷却窗口去重。部署时将 stdout/stderr 接入现有日志平台即可。

## 备份与恢复

定时备份使用 SQLite 原子备份 API，写入临时文件后执行 `PRAGMA integrity_check` 和 schema 检查，再原子改名。设置 `XIAOYI_REMOTE_BACKUP_DIR` 后，远程副本会复制并再次校验，校验失败不会被视为成功备份。

手动备份和验证：

```powershell
curl.exe -H "Authorization: Bearer $env:XIAOYI_ACCESS_TOKEN" -X POST http://127.0.0.1:4310/api/admin/backups
npm run backup:verify -- C:\ProgramData\Xiaoyi\backups\xiaoyi-backup-<timestamp>.db
```

恢复前必须停止服务，确认目标数据库不存在 `-wal` / `-shm` 活动 sidecar：

```powershell
npm run backup:restore -- C:\ProgramData\Xiaoyi\backups\xiaoyi-backup-<timestamp>.db C:\ProgramData\Xiaoyi\xiaoyi.db
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
