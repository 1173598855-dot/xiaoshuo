# Uiverse UI 质感与交互审查

日期：2026-09-22

## 范围

本轮只调整作者工作台 Renderer 的快捷操作、导航动效偏好开关、模型推理预设的触控尺寸与状态反馈，以及对应测试和第三方说明。没有修改 API、SQLite、Electron IPC、Provider 凭据、候选采纳或 revision 逻辑。

## 来源与许可证

- [Uiverse Toggle Switches](https://uiverse.io/ui/toggle-switches)：参考即时开关的轨道、滑块和状态表达；页面说明 toggle 适合立即生效的偏好设置，并标注 UI 元素为 MIT License。
- [Uiverse Galaxy](https://github.com/uiverse-io/galaxy)：确认社区元素集合的 MIT 许可和可选署名原则。
- 本项目没有加载 Uiverse 远程 CSS/组件；所有样式按 Xiaoyi tokens、原生 button 语义、键盘焦点和 `prefers-reduced-motion` 重新实现，归档说明见 [`docs/third-party/uiverse.md`](../../third-party/uiverse.md)。

## 实现审查

| 维度 | 结果 | 证据 |
| --- | --- | --- |
| 交互语义 | 通过 | 动效偏好保留原生 `button` 和 `aria-pressed`；切换后文本与滑块同步显示“满/低”。 |
| 键盘与焦点 | 通过 | 既有导航抽屉焦点恢复、Tab 循环、Escape 关闭测试继续通过；新增开关可由键盘触发。 |
| 状态覆盖 | 通过 | hover/active/disabled 由共享 CSS 提供；loading/error/success 由现有 Provider、首页服务错误、生产状态和认证测试覆盖。 |
| 动效降级 | 通过 | 新增按压、箭头位移和生产状态脉冲均在 `prefers-reduced-motion: reduce` 下关闭或静止。 |
| 响应式 | 通过 | 真实浏览器检查 1440×960、1024×768、390×844；移动端快捷菜单无页面级横向滚动，推理预设按钮提高到 40px。 |
| 性能与边界 | 通过 | 只使用 transform、box-shadow、颜色和边框过渡，不引入运行时依赖，不新增后端契约。 |

## 验证记录

- `node .../impeccable/scripts/detect.mjs --json src/client`：无检测命中。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run test:run`：95 个测试文件、399 个测试通过。
- `npm run build`：客户端、服务端构建和 built-server smoke 通过。
- `npm run e2e`：7 个浏览器测试通过，包含生产流程、导航抽屉、reduced-motion 和三种视口。
- 浏览器手动检查：快捷菜单、导航开关“满/低”切换、390px 页面和菜单截图通过。

## 非阻塞观察

本地开发页面仍会请求根路径默认 `favicon.ico`，当前响应为 404；它位于本轮限定范围之外，不影响工作台交互、构建或 E2E，后续可单独补充站点图标。
