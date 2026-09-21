# 动效组件库与作者工作台升级记录

日期：2026-09-21

## 目标与边界

本轮把公开参考库转成小奕自己的作者工作台能力：保留近黑画布、紫色主色、沉浸式书页和现有作者信息架构，不改变 API、数据库、Electron IPC、候选采纳、revision 或 Provider 凭据边界。所有新状态都在 Renderer 的本地 UI / `localStorage` / 当前组件状态内完成。

## 五个来源的审查结论

| 来源 | 适配结论 | 本地落地 |
| --- | --- | --- |
| [MotionSites](https://www.motionsites.org/motion) | 用它的动效分类、提示词结构和“先定义场景再定义运动”的方法做灵感参考；其服务条款明确资源按许可提供，不把受保护的提示词文件当作开源代码复制。 | 小奕自己的动效提示结构：状态、触发、持续时间、降级路径；不复制 Prompt、品牌或页面资源。 |
| [React Bits](https://github.com/DavidHDev/react-bits) | 本地镜像优先读取 TypeScript/CSS 变体；其许可为 MIT + Commons Clause，适合应用内改写，不做独立组件库再分发。 | 已有 `CursorGrid`、`SpotlightCard`、倾斜书架逻辑继续复用；新交互保持依赖轻量和键盘可达。 |
| [Uiverse](https://uiverse.io/) | 适合研究按钮、状态胶囊、边框和控件的微反馈；[Galaxy 仓库](https://github.com/uiverse-io/galaxy)为 MIT。 | 仅提取“状态—边框—反馈”的结构，用小奕 tokens 重写动效按钮和快捷选择器。 |
| [Anime.js](https://animejs.com/documentation/) | 官方文档覆盖 Timeline、Animation、Draggable、SVG、Text 与 WAAPI；官方仓库为 MIT，适合单点编排而非全站动画化。 | `StoryPulse` 使用 Anime.js 编排当前生产阶段的轻量入场；失败和 reduced-motion 时不播放。 |
| [Aceternity UI](https://ui.aceternity.com/explore) | 组件目录适合研究 Spotlight、Card Hover、Keyboard、Empty State、Multi Step Loader 等模式；组件/区块许可按条目核验，Tailwind/Next 依赖不直接引入。 | 转为原生 TypeScript/CSS：导航筛选、工作流一键填充、故事状态轨道和状态面板，不复制其源码。 |

## 已落地的 12 项升级

1. 新增持久化动效偏好：完整动效 / 安静动效，默认尊重系统 `prefers-reduced-motion`。
2. 安静动效会压低光晕、黑洞背景、书架倾斜和页面装饰转场，但保留成功、失败、加载等状态反馈。
3. 工作区导航抽屉新增工具筛选输入框。
4. 抽屉支持 `/` 快速聚焦筛选框，`Escape`、Tab 焦点循环和清除筛选保持可达。
5. 命令面板支持子序列模糊匹配，短输入也能找到“故事时间线”等操作。
6. 命令面板记录最近使用的 5 个动作并优先展示，仍保留键盘快捷键与 ARIA listbox 语义。
7. 首页增加“换个灵感”，直接轮换本地灵感册，不离开故事输入区。
8. 故事输入区增加实时字数反馈，与草稿自动保存状态并列显示。
9. 作品书架增加指针景深微交互，触摸端不依赖 hover，reduced-motion 下自动退化。
10. 生产室新增 `StoryPulse` 故事生产轨道，显示基础设定、卷章规划、逐章写作、正式成书的当前状态和失败节点。
11. 正文页新增滚动阅读进度条，不改正文内容和导出契约。
12. 模型设置增加“快速 / 平衡 / 深思”思考等级快捷按钮，工作流增加“用当前模型填充全部角色”，减少重复配置。

## 视觉与交互验收重点

- 新控件沿用现有紫色 action、近黑 surface、8px 圆角和全局 focus-visible；
- 状态轨道使用图标、文字和边框三种信号，不依赖颜色单独表达状态；
- Anime.js 只负责一个有业务意义的阶段反馈，不把正文变成展示动画；
- 动效控制、系统 reduced-motion、触摸端和键盘端均有降级路径；
- 1440×960、1024×768、390×844 检查抽屉筛选、首页表单、书架、生产轨道和正文进度条不产生页面级横向滚动。

## 契约安全

本轮没有新增 API、数据库字段、IPC 频道或候选/正文写入路径。新偏好与最近动作只保存于当前浏览器 `localStorage`，生产轨道只读取现有 `run` 状态，正文进度只读取窗口滚动位置。
