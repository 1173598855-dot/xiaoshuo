# OpenAI-Compatible 模型列表最小实现设计

日期：2026-08-16

状态：已确认，进入实施计划。

## 1. 目标

为现有模型配置对话框增加一次性模型列表拉取能力。作者输入 OpenAI-compatible Provider 的服务地址和可选 API Key 后，可以直接拉取模型 ID、选择一个模型，再保存配置。

完成标准：

- 仅 OpenAI-compatible Provider 显示模型列表刷新入口；
- 当前表单尚未保存时也可以拉取模型；
- 桌面端可以在表单未输入 Key 时安全复用完全匹配的 Main-only Vault 凭据；
- 拉取结果只存在于当前 Renderer 内存，不改变已保存设置或当前模型；
- 模型目录不可用时仍可手工输入模型 ID；
- API Key 不出现在响应、日志、公开错误、SQLite 或模型列表结果中。

## 2. 范围

首个增量只支持 catalog 中 `kind === "openai-compatible"` 的 Provider：DeepSeek、通义千问、OpenRouter、SiliconFlow、Ollama 和自定义兼容端点。

OpenAI、Anthropic 和 Google 继续使用现有静态模型建议。本增量不增加 Provider 能力协商、模型能力识别、分页 UI、持久缓存、自动刷新、后台预取或模型可用性探测。

不修改 SQLite schema、generation 状态流、Provider 设置文件格式或 Provider Vault 文件格式。

## 3. 用户交互

OpenAI-compatible Provider 的“模型 ID”字段旁增加一个带 tooltip 的刷新图标按钮。

点击按钮时：

1. 使用当前表单中的 Provider、Base URL 和新输入的 API Key；
2. API Key 为空时，只在当前表单与已保存 Provider 和有效端点完全匹配时复用已保存凭据；
3. 拉取期间禁用刷新按钮并显示稳定的加载状态；
4. 成功结果与 catalog 静态建议合并、按模型 ID 去重，写入现有 `datalist`；
5. 当前模型 ID 不会因列表刷新而改变；
6. 失败时保留当前模型和已有动态结果，并在字段附近显示公开错误。

切换 Provider 或修改 Base URL 时清空旧动态结果。请求返回时再次核对请求身份；若 Provider 或 Base URL 已变化，忽略旧响应。

拉取动作不自动保存 Provider 设置。最终仍由现有“保存模型配置”命令提交设置和可选密钥。

## 4. 跨边界契约

`src/shared/contracts.ts` 新增严格 Zod 契约：

- `ListProviderModelsInputSchema`
  - `providerId: ProviderId`
  - `baseUrl?: CompatibleBaseUrl`
  - `apiKey?: string`，沿用现有 2,000 字符限制
  - 拒绝额外字段
- `ProviderModelSchema`
  - `id: string`，去除首尾空白后长度为 1 至 200
  - 拒绝额外字段
- `ProviderModelListSchema`
  - 最多 500 个 `ProviderModel`

输入 schema 只描述跨端数据形状。Provider 是否为 OpenAI-compatible、固定端点是否允许覆盖 Base URL、是否必须提供 Key，由服务端基于 catalog 再校验，不能信任 Renderer 推断。

`WorkbenchTransport` 增加：

```ts
listProviderModels(
  input: ListProviderModelsInput,
  signal?: AbortSignal,
): Promise<readonly ProviderModel[]>;
```

## 5. 请求架构

```text
ProviderDialog
  -> WorkbenchTransport.listProviderModels(input)
     -> Web: POST /api/providers/models
        -> resolve OpenAI-compatible config
        -> listOpenAICompatibleModels
     -> Desktop: allowlisted Preload/IPC channel
        -> ProviderVault resolves entered or saved key
        -> listOpenAICompatibleModels
  <- [{ id }]
```

浏览器模式沿用现有凭据策略：HTTP transport 优先使用当前表单 Key；表单 Key 为空且 Provider 与端点匹配时，可复用 `sessionStorage` 中的当前会话 Key。完整配置只存在于当前请求内存，不持久化到服务端。

桌面模式的 Renderer 可以把作者当前新输入的 Key 发送给 Main，行为与现有 `provider.saveSettings` 一致，但 Main 不保存这次拉取输入。表单未提供 Key 时，Main 通过 Provider Vault 解析当前已保存凭据；只有 Provider ID 和规范化后的有效端点均匹配时才允许复用。已保存 Key 永远不返回 Renderer。

IPC 增加一个固定白名单频道。输入经共享 schema 校验，sender 继续执行现有主窗口、主 frame 和可信 Renderer URL 校验，输出继续使用 `DesktopResult<T>` 和公开错误归一化。

## 6. OpenAI-Compatible 请求

新增 `src/server/providers/openai-compatible-models.ts`，只负责从已解析的 OpenAI-compatible 配置读取模型目录。

实现使用现有 OpenAI SDK 的 `models.list()`：

- `baseURL` 使用已经过契约和 catalog 校验的有效端点；
- 无 Key 的合法本地端点使用与现有兼容适配器一致的非空占位值；
- 超时 15 秒；
- `maxRetries: 0`；
- 最小版本只消费首个响应页；
- 丢弃空 ID 和超过 200 字符的 ID；
- 按 ID 去重并使用稳定字典序排序；
- 最多返回前 500 项；
- 不返回 owned_by、时间戳、权限或任何上游扩展字段。

服务地址不自动追加 `/v1`。不同兼容网关的 API 前缀不一致，猜测路径可能把合法端点请求到错误资源。UI 在端点返回网页或非模型响应时提示作者确认 API 前缀，常见值为 `/v1`。

## 7. 错误与并发

复用现有 Provider 公开错误分类：

- `AUTHENTICATION_FAILED`：Key 无效或缺失；
- `RATE_LIMITED`：模型目录请求被限流；
- `REQUEST_INVALID`：Provider、Base URL、API 前缀或响应形状无效；
- `UPSTREAM_UNAVAILABLE`：连接、超时或上游 5xx；
- `UNKNOWN_PROVIDER_ERROR`：无法分类的失败。

上游返回 HTML、无法解析的 JSON 或缺少模型数组时归一化为 `REQUEST_INVALID`。UI 为该错误补充“请确认服务地址包含正确的 API 前缀，常见为 `/v1`”。原始响应正文、SDK cause、请求头和 Key 不跨 HTTP/IPC 边界。

浏览器请求使用传入的 `AbortSignal`。最小桌面 IPC 不新增请求 ID 或取消频道；ProviderDialog 使用本地请求身份忽略过期响应，Main 依靠 15 秒 SDK 超时收敛请求。

## 8. 文件范围

生产代码预计修改：

- `src/shared/contracts.ts`
- `src/server/providers/openai-compatible-models.ts`（新增）
- `src/server/app.ts`
- `src/desktop/provider-vault.ts`
- `src/desktop/ipc/channels.ts`
- `src/desktop/ipc/handlers.ts`
- `src/desktop/preload-api.ts`
- `src/client/api/transport.ts`
- `src/client/api/client.ts`
- `src/client/api/http-transport.ts`
- `src/client/api/ipc-transport.ts`
- `src/client/App.tsx`
- `src/client/components/ProviderDialog.tsx`
- `src/client/styles/app.css`

不为此功能增加数据库迁移、后台任务、全局缓存或通用 Provider capability 抽象。

## 9. 测试

按 RED -> GREEN 增加以下覆盖：

- 共享契约：非法 URL、额外字段、空或过长模型 ID、超过 500 项；
- 模型目录 helper：正确 Base URL 和 Key、无 Key 本地端点、超时、不重试、首个响应页、过滤、去重、排序和上限；
- Hono 路由：拒绝非兼容 Provider、解析浏览器输入、归一化错误、响应不含 Key；
- Provider Vault：临时 Key 优先、匹配设置复用 Vault、Provider 或端点不匹配时拒绝复用；
- IPC/Preload：白名单频道、Zod 输入、可信 sender、公开错误和无凭据输出；
- HTTP/IPC transport：请求映射、响应 schema 和错误映射；
- ProviderDialog：按钮可见性、加载状态、动态建议、手工模型保留、失败不清空、Provider/端点变化后忽略旧响应。

所有自动化使用注入的假 SDK client 或 transport，不访问真实模型服务。

完成后运行：

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run e2e
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
npm run desktop:package:test
npm run desktop:installed:test
node scripts/assert-desktop-artifact.mjs
git diff --check
```

## 10. 验收条件

- 在自定义兼容端点输入正确 `/v1` Base URL 和有效 Key 后，一次点击即可获得模型 ID 列表；
- 固定兼容 Provider 使用 catalog 中的 Base URL，不能被 Renderer 覆盖；
- Ollama 等无 Key 回环端点可以拉取模型；
- 拉取不自动保存设置，不改变当前模型，不修改正文或 generation；
- 列表失败后仍可手工输入和保存模型；
- 已保存桌面 Key 不进入 Renderer、响应、日志、SQLite、备份或导出；
- Web 与 Desktop transport 对 UI 暴露相同结果和公开错误语义。
