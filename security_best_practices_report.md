# 安全最佳实践审查报告

审查日期：2026-09-16

范围：React/Vite 前端、Hono/Node 服务端、Electron Main/Preload/IPC、桌面发布配置，以及本次故事时间线/资料卡改动。

## 结论

未发现可由本次改动引入的 Critical/High 安全问题。扫描确认没有新增 `dangerouslySetInnerHTML`、DOM HTML 注入、动态代码执行、开放重定向或不受约束的 `postMessage`；时间线接口使用共享 Zod 契约、作品 revision 乐观锁和现有作品所有权检查。桌面端继续保持 ASAR、生产 source map 默认关闭、Renderer 隔离、IPC 白名单和打包版调试参数拒绝。

## 已修复项目

### SEC-001：打包版调试参数可能来自不同 Electron 参数集合

- 严重性：Medium（已修复）
- 位置：`src/desktop/main.ts:142`、`src/desktop/runtime-policy.ts` 的 `hasDisallowedDebugArgument`
- 证据：启动时同时检查 `process.execArgv` 和 `process.argv.slice(1)`，拒绝固定 `--inspect`、固定 `--inspect-brk`、固定 `--remote-debugging-port` 和暴露 GC 的 `--js-flags`；仅允许 Electron 测试 harness 使用的 OS 分配参数 `--inspect=0`/`--remote-debugging-port=0`。
- 影响：仅检查 Node 的一组参数时，另一组参数可能让打包版暴露调试入口，增加本地逆向和运行时注入成本。
- 验证：新增桌面 runtime-policy 单测覆盖四类参数和普通参数。

## 已确认的安全控制

- 前端 CSP：`vite.config.ts:25` 为开发/生产构建生成 CSP；生产脚本和样式只允许同源资源。
- Electron 窗口：`src/desktop/window-security.ts:58-62` 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`；打包版关闭 DevTools 并拦截常见快捷键。
- 产物加固：`package.json:58` 启用 ASAR；`tsup.desktop.config.ts:15` 只有显式 `XIAOYI_DESKTOP_SOURCEMAP=1` 才生成桌面 source map。
- 数据边界：浏览器 Provider 配置和账号会话只进入当前 `sessionStorage`/请求内存；桌面凭据由 Main 的 Vault 管理，Renderer 不接收已保存 API Key。
- 输入与授权：新增时间线 PATCH 和桌面 IPC 都使用共享 Zod schema；服务端/桌面 Main 都按作品所有权校验，保存要求 `expectedBookRevision`。
- 作者工具边界：批量时间线、重排、AI 预览采纳、搜索和一致性检查均经过共享 schema 与作品所有权校验；AI 预览不会直接写入正文或章纲，只有作者采纳才会提交。
- 备份边界：桌面加密备份使用 AES-256-GCM 和 scrypt 派生密钥，密码不进入 SQLite、日志或导出内容；更新配置显式要求签名可验证。
- Provider 观测边界：usage 只保存模型、Token、缓存计数和费用，不保存 prompt、思考内容、API Key 或响应全文；思考等级仅映射为受限枚举值。
- UI 输出：故事想法、时间线和资料卡内容通过 React 正常文本节点/表单渲染，没有新增 HTML 注入点。

## 残余风险与发布要求

### R-001：浏览器会话信息可被同源 XSS 读取

- 严重性：Medium（设计残余，不是本次新增漏洞）
- 位置：`src/client/access-token.ts:6-15`、`src/client/provider-session.ts:32-43`
- 说明：项目约束明确允许浏览器模式使用 `sessionStorage` 保存当前会话 Provider 配置和访问令牌；这不会跨浏览器持久化，但同源脚本仍可读取它们。
- 缓解：生产 CSP、React 默认转义、无动态 HTML sink；后续若要进一步降低风险，应迁移到 HttpOnly/SameSite 会话 Cookie，并同步设计 CSRF 防护。

### R-002：反逆向不是绝对防破解

- 严重性：Low（预期产品限制）
- 说明：ASAR、关闭 DevTools、拒绝调试参数、source map 默认关闭和签名只能提高篡改/逆向成本；离线桌面程序最终仍运行在用户机器上，不能替代服务端授权或证明不可破解。
- 发布要求：生产密钥对必须替换仓库内测试公钥对应的本地私钥；Windows 发布流水线必须使用正式代码签名证书，并在交付前验证签名和证书链。

## 未发现项目

- 未发现 `dangerouslySetInnerHTML`、`innerHTML`、`eval`、`new Function`、字符串形式定时器、开放重定向或 `postMessage('*')`。
- 未发现新增 API Key 写入 SQLite、日志、备份、导出、generation、候选或 IPC 返回值的路径。
- 未发现第三方 CDN 脚本或未固定来源的动态脚本注入。
