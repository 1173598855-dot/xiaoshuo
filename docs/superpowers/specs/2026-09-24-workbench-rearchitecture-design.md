# 小奕工作台整体框架与交互改版设计

日期：2026-09-24

状态：用户已授权整体开发；此设计记录开发前审查与实施边界。

## 1. 目标

把首页、方向选择、生产与审核、正式正文组织成清楚连续的作者工作台。作者任何时候都能确认当前作品、所在阶段和下一步；高频创作动作优先呈现，辅助工具按上下文打开。工程上收拢前端编排、HTTP/IPC 入口和样式/动效系统，同时保留现有 SQLite、Provider、Electron 和长篇生产能力。

## 2. 开发前审查

- 当前技术栈为 React/Vite、Hono、Node `node:sqlite`、共享 Zod 契约和 Electron Main/Preload/IPC；server service/repository 分层及客户端 HTTP/IPC 双适配器已存在。
- `src/client/App.tsx` 约 660 行，承担启动恢复、认证/激活、作品流程、Provider/工作流、生产控制和全局面板状态；页面分支中多次挂载相同导航、对话框和命令面板。
- 首页、方向、生产、审核和正文的核心组件已功能完整，但主操作和辅助工具的视觉权重接近；生产室是长滚动页面，候选正文和下一步审核不够突出；`ChapterReview` 将多种辅助检查纵向堆叠。
- `app.css` 与 `workbench-refresh.css` 合计约 244 KB 源文件，并与局部组件 CSS 混用；旧青绿/橙色光效与紫色 action token 并存，组件未分层的 CSS 会压过层内主题规则。
- 首页叠加 SVG 光束、全屏 Canvas 网格、背景图片、Spotlight 和 3D 灵感册；部分光标/光束监听不会在手动安静模式切换后及时卸载。页面进入还存在约半秒以上的分段显现。
- 当前构建基线为首页 JS 315.74 KB（gzip 94.66 KB），初始 CSS 196.23 KB（gzip 33.59 KB）。工作区已有未提交的情节火花、光晕调整、文档和测试，应一并保留。

## 3. 体验原则

1. 故事想法、当前候选和正式正文是页面主角；说明文案和装饰不应把它们推离第一视觉层。
2. 每个页面清楚标出当前作品、阶段、章节、内容状态和下一步。
3. 方向选择、自动开写、候选采纳等操作明确表达后果；保持现有业务语义。
4. 记忆、时间线、Diff、质量、搜索和历史按需展开，不和主内容争夺空间。
5. 光感表现当前焦点或状态；页面保持安静，动效时间短，并遵守应用安静模式及系统减少动态偏好。
6. 桌面、平板和手机共享同一信息层级，布局重排而非缩小。

## 4. 落地后的信息架构

```text
App（启动恢复、认证/激活、当前作品/生产任务、页面编排）
├─ Home：继续作品 / 新建故事 / 本地资产
├─ Directions：整本方向比较与确认
├─ ProductionRoom：候选审核 + ChapterWorkspace
├─ ManuscriptView：正文阅读、导入与交付
└─ AppShell（接收当前页面上下文，统一承载全局界面）
   ├─ WorkbenchNavigationDrawer
   ├─ CommandPalette
   └─ 单一活动工具：设置 / 记忆 / 时间线 / 搜索 / 质量 / 历史 / 交付
```

- `App` 继续作为启动恢复、认证/激活、书籍与 run 数据的应用编排器；本轮不移动这些既有业务流程。
- `App` 只创建一次 `AutoNovelApi` HTTP/IPC 适配器，并传给生产室和全局工具；Provider、工作流设置仍使用现有 `apiClient` 边界。
- `AppShell` 接收当前页面上下文，唯一挂载全局导航、命令面板和一个活动工具；工具状态不再由 App 中多组独立布尔值控制。
- 页面 feature 容器持有章节、候选、批注和面板内的临时交互状态；章节树与上下文仍由现有响应式工作区组件适配窄屏。

## 5. 主流程交互

### 首页与方向

- 首页首屏优先显示“继续作品”和“新建故事”；故事火花、预设和资产保留为可发现的辅助能力。
- 方向支持快速比较、查看单个详情和明确确认。现有“自动选第一方向并开写”作为次级快捷动作保留，说明会自动选取并启动生产。
- 本地草稿恢复/自动保存、方向数范围和 Story Spark 的“抽取不改草稿、作者显式加入”语义保持。

### 生产与审核

- 生产状态收敛为顶部阶段条和可扫读状态；当前章节、候选状态和“审阅当前候选”成为主区域。
- 候选正文、审核发现和可执行决策留在主视图；Diff、记忆提议、章纲证据、候选历史和修订恢复按需打开检查面板。
- 重写、候选编辑和选区精修仍然先更新候选并重新审核；章纲兑现检查仍是非阻断参考。
- 自动生产、暂停/恢复和采纳行为沿用当前业务规则。任何正式正文写入仍只能经现有 atomic accept 与 revision 校验。

### 正文与交付

- 正文默认是稳定阅读/编辑 surface，章节导航留在侧边或移动 sheet；导入、排版和导出收纳到上下文工具。
- 从正文返回生产时保留作品、章节和候选位置；正文 revision、快照、交付中心和备份能力保持现有服务端所有权。

## 6. 前端与服务端边界

- 建立单一 `AutoNovelApi` 组装入口，负责一次性选择 HTTP 或 Electron IPC adapter 并复用该实例；Provider/工作流的 `apiClient` 继续拥有自己的跨端操作。跨端 DTO 仍只从 `src/shared` 的 Zod schema 导出。
- Hono 路由和桌面 IPC 注册按 auth、books/outline、production/candidates、memory、authoring/delivery 等领域拆分。入口负责身份/参数/公开错误；跨 repository 的用例继续由 server services 处理。
- 先保持 endpoint、IPC channel、SQLite 表和 Provider SDK 兼容；结构调整本身不增加数据库迁移。
- CSS 逐步从全局级联迁往 token、共享控件和 feature 样式层；每次删旧规则都要按页面检查，避免大范围一次性改写。

## 7. 色彩、光感与动效

- 紫色 `--action-primary` 是唯一主要交互光色；成功、警告和错误色只表达状态。
- 作品画布保留低对比静态纹理；每个活动页面至多使用一个局部交互 spotlight。全屏 CursorGrid、背景光束、黑洞图和移动边框逐页审查，保留对当前动作有帮助的效果。
- 建立统一 `MotionPolicy`（full / quiet / system reduced）；quiet 或系统减少动态偏好时，CSS 动画与 JS pointer/RAF 工作同时停用。
- 页面内容首帧可见；150–250ms 动效用于抽屉、焦点、状态更新和保存反馈。保留安静动效开关。

## 8. 不可变更约束

- Provider Key 不进入 Renderer、SQLite、日志、生成记录或公开响应。
- 候选不直接改正式正文；章节修改继续传 `expectedRevision`；旧 `baseRevision` 候选不可采纳；accept 校验与正文写入仍然原子。
- Electron 保持白名单 IPC、共享 schema、Main-only 密钥、BrowserWindow sandbox/isolation 配置和 Main-owned 文件/数据库操作。
- API、IPC 和持久化行为没有经过明确设计与回归测试时，不改变自动生产、方向快捷操作或候选状态语义。

## 9. 验收

- 页面切换保留作品/阶段/章节上下文，导航和全局工具只挂载一次。
- 键盘可完成新建、选方向、进入审核、打开工具、关闭并回到原焦点；移动端主决策操作不被遮挡。
- `1440×960`、`1024×768`、`390×844` 无页面横向溢出、裁字或抽屉重叠。
- quiet 与 `prefers-reduced-motion` 下不启动持续 Canvas/RAF/光束工作，流程功能不变。
- 首页初始 JS gzip ≤94.66 KB，初始 CSS gzip ≤33.59 KB；重构阶段不得静默突破当前基线。
- 全量 `lint`、`typecheck`、Vitest、build/server smoke、Web E2E、auth E2E、desktop smoke 和 desktop E2E 通过；发布包门禁只在形成桌面发行物时执行。
