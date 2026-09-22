# Aceternity UI 沉浸层审查

日期：2026-09-22

## 目标与范围

本轮在上一轮 Anime.js 动效之上增加一层可关闭、低干扰的作者工作台沉浸感：Spotlight 指针聚焦、SVG Background Beams、写作路径 Tracing Beam 和故事起点 Moving Border。改动只涉及 Renderer、测试和文档，不改变 API、SQLite、Electron IPC、凭据、候选采纳或 revision 逻辑。

## 来源与许可证判断

- [Spotlight](https://ui.aceternity.com/components/spotlight)：用于“把注意力放到当前创作表面”的聚焦思路。
- [Background Beams](https://ui.aceternity.com/components/background-beams)：用于多条 SVG 路径光束的氛围层。
- [Tracing Beam](https://ui.aceternity.com/components/tracing-beam)：用于表达写作路径当前进度的追踪线。
- [Moving Border](https://ui.aceternity.com/components/moving-border)：用于故事起点卡的边缘运动。
- [Stateful Button / 组件目录](https://ui.aceternity.com/components)：用于状态反馈的交互方向。
- [官方许可证](https://ui.aceternity.com/licence)：Aceternity 下载组件按其 Aceternity License 约束；本项目没有复制或重新分发原始组件源码，只把视觉/交互模式按本地 token 改写为 SVG/CSS。实现细节见 [`docs/third-party/aceternity-ui.md`](../../third-party/aceternity-ui.md)。

## 技术审查

| 维度 | 结果 | 证据 |
| --- | --- | --- |
| 视觉层级 | 通过 | Ambient layer `aria-hidden`、`pointer-events:none`，内容层 z-index 高于氛围层；正文和候选仍是最高信息层级。 |
| 性能 | 通过 | 光束只动画 `stroke-dashoffset`，Moving Border 只动画 transform；不引入 Tailwind/Next/远程组件，Anime.js 仍动态导入并可取消。 |
| 可访问性 | 通过 | 装饰层隐藏于辅助技术；写作路径保留现有 `aria-current`；键盘焦点、抽屉焦点恢复和菜单交互保持不变。 |
| 响应式 | 通过 | Tracing Beam 在窄屏切换为纵向，Ambient layer 不参与布局，主流程无水平滚动。 |
| 降级 | 通过 | 系统 `prefers-reduced-motion`、应用“安静动效”和触摸设备均会停止光束/边框/指针聚焦动画。 |
| 业务边界 | 通过 | 仅新增视觉组件、CSS、测试和文档；无服务端或持久化 diff。 |

## 验证证据

- `node .../impeccable/scripts/detect.mjs --json src/client`：无检测命中。
- 真实浏览器：检查首页 Spotlight/光束、更多菜单、导航抽屉、390px 移动布局与焦点恢复；截图保存在 `output/playwright/aceternity-home.png`。
- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run test:run`：400 个测试通过。
- `npm run build`：客户端、服务端和 built-server smoke 通过。
- `npm run e2e`：7 个浏览器测试通过，包含 1440×960、1024×768、390×844、reduced-motion 和主创作流程。
- 移动端 E2E 曾捕获到顶栏菜单被状态条拦截的 z-index 回归，已通过排除 header/page-topbar 的沉浸层定位规则修复，并重新验证菜单点击通过。

## 非阻塞观察

开发页面的根 `favicon.ico` 仍有 404 请求；该文件不属于本轮 `src/client` 视觉范围，不影响构建、交互或 E2E，留作独立站点资源任务。
