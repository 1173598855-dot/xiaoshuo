# 整体工作台框架与前端交互改版实施计划

关联设计：[整体框架与交互改版设计](../specs/2026-09-24-workbench-rearchitecture-design.md)

## 范围与迁移策略

保留 React/Vite、Hono、SQLite、Electron 和既有跨端 Zod 契约。按功能切片迁移，保持当前工作区的未提交情节火花和光晕变更。每个切片先补行为测试，再替换旧实现；不引入数据库迁移，不一次性重写 Provider、记忆和 revision 系统。

## 工作包

### P0 开发前审查与目标架构

- [x] 检查当前 git 状态、产品原则、核心规格、近期 UI/动效计划、主要页面和跨端边界。
- [x] 确认现有修改属于用户刚授权的范围；确认 `main` 与 `origin/main` 同步，保留未提交 Story Spark/光晕改动。
- [x] 明确核心摩擦：根状态与 overlay 重复、候选审核层级弱、页面工具堆叠、光效/动效偏好未统一、CSS 全局级联漂移、路由与 IPC 注册重复。
- [x] 建立本设计说明和分阶段计划。

### P1 AppShell 与导航状态收敛

- Objective：减少根组件编排和重复挂载，建立一个清晰持有当前作品/阶段/活动工具的外壳。
- Ownership：`src/client/App.tsx`、`src/client/app/**`（新）、App 层测试。
- Dependencies：P0。
- Invariants：启动恢复和登录/激活路径不变；切换作品/阶段仍保留上下文；按钮行为与现有 API 一致。
- Checks：客户端启动/恢复/认证测试、typecheck、Web E2E、三视口导航和焦点检查。
- Done criteria：全局 nav、dialogs、drawer、command palette 有唯一挂载宿主；root 不再拥有按面板拆分的大量布尔状态。
- [x] 全局导航、命令面板与作者工具只挂载一次；面板状态收敛为互斥活动工具状态。
- [x] 回归覆盖启动恢复、暂停任务、方向选择、一键开写与正文流程。
- [x] 页面选择与 AppShell 装配移入独立 `WorkbenchView`，按首页/方向/生产/正文/工具分组状态和动作。

### P2 首页与方向选择主流程

- Objective：首页先呈现继续/新建，方向页先比较再选择；将辅助创作能力按需呈现。
- Ownership：`CreativeHome.tsx`、`DirectionPicker.tsx`、对应组件和 E2E。
- Dependencies：P1；保留 current Story Spark。
- Invariants：草稿与预设本地保存；Story Spark 只在明确加入时写入；普通方向选择不自动开始生产；快捷自动选择继续说明后果。
- Checks：首页草稿/资产/预设测试；鼠标与键盘方向比较；1440/1024/390 E2E。
- Done criteria：新作者能从首页进入创建；已有作者能直接继续作品；方向选择的主/次操作可辨识。
- [x] 首页并列呈现最近作品与新建入口，保留完整书架和本地草稿流程。
- [x] 预设、换灵感、情节火花、方向数量移入折叠构思工具；仅明确加入才写入情节火花。
- [x] 方向卡新增鼠标预览；预览包含最终走向、支持 Escape 关闭和焦点返回。

### P3 生产、审核与正文工作区

- Objective：让当前章节候选审核成为生产主视图，把监控和辅助工具按需展开。
- Ownership：`ProductionRoom.tsx`、`ChapterWorkspace.tsx`、`ChapterReview.tsx`、`ManuscriptView.tsx` 及其对应测试。
- Dependencies：P1。
- Invariants：候选隔离、重写/编辑后重审、章纲报告非阻断、记忆审阅、revision 和 atomic accept 语义不变。
- Checks：production/candidate/memory 测试、HTTP/IPC 行为对照、桌面和浏览器 E2E、三视口键盘检查。
- Done criteria：当前阶段/章/候选清晰；审核主路径不再被任务卡、历史和辅助工具淹没；正文返回后恢复原位置。
- [x] 候选审核前置；运行日志、进度、章纲报告、历史与作者工具按需展开。
- [x] 生产章节选择与生产/正文滚动位置按作品会话级恢复。
- [x] ProductionRoom 共用 App 入口创建的 HTTP/IPC adapter。

### P4 Token、CSS 层级与统一 MotionPolicy

- Objective：整理遗留色彩和 CSS 覆写，减少重复全屏光效，将 quiet/system reduced-motion 落到 JS 与 CSS 两端。
- Ownership：`src/client/styles/**`、`src/client/motion/**`、CursorGrid / AmbientLayer / Spotlight 等装饰组件及相关测试。
- Dependencies：P0；P2/P3 页面层级稳定后完成页面级样式迁移。
- Invariants：紫色 action token 与语义状态色；装饰仍 aria-hidden；reduced-motion 和 quiet 不改变功能；性能不高于现基线。
- Checks：design token hygiene、motion/unit 测试、浏览器 console、焦点/键盘/quiet/reduced-motion、三视口截图对照。
- Done criteria：同一效果不叠加多个全屏 pointer/Canvas 光源；主题/quiet 覆写有效；初始 CSS gzip ≤33.59 KB。
- [x] Token/CSS 覆写按层整理；删除首页失效样式和重复进场规则。
- [x] 单一 MotionPolicy 同时处理手动 quiet、系统 reduced-motion、光标监听、RAF 与 Anime.js。
- [x] 首页移除重复 CursorGrid canvas/pointer 层；保留一个轻量 Ambient spotlight。
- [x] 最终构建首页 JS/CSS gzip 分别为 94.19 KB / 33.28 KB，均不超过基线。

### P5 HTTP/IPC 边界整理

- Objective：按领域拆分 Hono 与桌面白名单 IPC 注册，让两端继续调用相同的业务服务/用例。
- Ownership：`src/server/auto-novel-app.ts` 与新 `src/server/routes/**`、`src/desktop/ipc/auto-novel-handlers.ts` 与新领域 handler 模块、跨端适配器及对应测试。
- Dependencies：P0；公开契约不改。
- Invariants：共用 Zod schema；Main-only secrets；HTTP 公开错误归一化；IPC 白名单；数据库和文件仍由 Main/service 所属边界管理。
- Checks：API route/IPC 单测、契约测试、repository/service 全量测试、typecheck/build。
- Done criteria：公开路径/channel 和响应语义不变；跨仓库业务规则留在 application services，不搬进 Renderer 或 handler。
- [x] HTTP 路由按领域拆分，原 77 组 path+method 保持一致。
- [x] 桌面 IPC handler 按领域拆分，原 54 个 channel 注册项保持一致。

### P6 集成、文档和 GitHub 交付

- [x] 汇总所有切片并清理失效 CSS/状态代码，diff 自审。
- [x] 更新 README、PRODUCT.md、规格/计划复选框。
- [x] 运行全部通用门禁、Web E2E、auth E2E 和桌面 smoke/E2E。
- [x] 验证当前基线内的 JS/CSS gzip 体积与三视口键盘/减少动态效果路径。
- [x] 以清楚的提交说明提交整体改版并推送 `origin/main`；发行包只有在用户要求发布时重新构建。

## 执行波次

1. P1 AppShell 与 API 装配入口（先只移动状态/挂载点，不改业务行为）。
2. P2 与 P3 分页迁移，分别承担首页/方向与生产/审核/正文；共用 CSS 由 P4 单独拥有，避免文件冲突。
3. P4 统一样式/动效，在每个页面切片后删除已被覆盖的旧选择器。
4. P5 拆传输注册，保持 endpoint/channel/DTO 不变。
5. P6 全量回归、diff 自审、commit/push。

## 风险与缓解

- **启动恢复和页面切换回归**：先固定书籍恢复、方向选择、任务恢复、正文返回的行为测试；AppShell 初版只移动状态/挂载点，不改服务调用。
- **自动流程的含义变化**：保持当前“一键开写”、自动审核/修复/accept 事务；仅调整文字说明和操作层级，所有变化要由 HTTP 与 IPC 场景验证。
- **样式级联突然改变**：按共享控件/页面分批转层，每迁一页对比 desktop/tablet/mobile 截图；只删除已确认失效的规则。
- **动效静音遗漏**：统一 JS 与 CSS 的 effective motion policy；测试手动 quiet、系统 reduced-motion、偏好运行中切换、触摸设备四条路径。
- **HTTP/IPC 分拆行为漂移**：保持路由/channel/DTO 原样，以同一 service 调用为依据补 parity 测试；handler 不新增领域决策。
- **初始资源体积反弹**：每个前端切片记录 gzip 构建输出，初始 JS/CSS 超过基线时先回收其静态依赖再合并。
