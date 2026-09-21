# 第二轮前端细节优化记录

日期：2026-09-21

## 反馈与源码定位

本轮以用户提供的两张截图为视觉验收基线：

- 工作流模式原生 `<select>` 展开后出现浅色系统选项层，暗色文字与禁用/非选中态对比不足，描述信息也无法表达“多模型协作”的实际分工。
- 首页有较多英文装饰性 microcopy，表单和线框层级偏硬，圆角、输入控件和弹窗没有完全收敛到同一套工作台语言。

源码审查覆盖 `WorkflowDialog`、`ProviderDialog`、首页工作台组件、共享 tokens、`app.css` 末端主题层、`workbench-refresh.css`、对应客户端单测和 E2E。额外发现 Provider 目录暂时为空且 settings 为 null 时，初始化 effect 可能读取 `settings.model`，已一并修复为安全空状态。

## 参考站点与只取交互规律

本轮公开参考：

- [Linear](https://linear.app/)：密集但清晰的层级导航、状态标签、上下文动作和“工作对象先于装饰”的信息密度。
- [Raycast](https://www.raycast.com/)：键盘优先、命令入口短、每个动作都有明确反馈和可预测的快捷键。
- [Notion](https://www.notion.com/product)：把知识、搜索和自动化分成清晰入口，复杂能力按渐进层级出现。
- [Figma](https://www.figma.com/)：共享组件/库、上下文一致性和“设计—构建”连续工作流。

这些站点只用于判断交互与信息架构，不复制源码、资源、品牌色、文案或视觉构图。

## 本轮落地

- `WorkflowModePicker`：替换工作流模式原生下拉，提供暗色 listbox、模式说明、选中勾选、鼠标/键盘操作、Esc 回收焦点和 fixed 定位，避免被弹窗滚动容器截断。
- `ProviderDialog`：空 Provider 目录安全渲染，不再因空 settings 读取空对象字段。
- 文案润色：首页从“LOCAL FIRST / AUTHOR MODE”“IDEA → NOVEL”等装饰性英文改为自然中文；正文、工作流提示、快速操作页脚同步统一词汇。
- 样式收敛：弹窗、工作流角色行、输入框、select、状态条和快捷按钮统一近黑 surface、紫色 focus ring、8px 控件圆角和更低干扰的边框；保留高密度工作台，不引入玻璃化正文或大面积渐变。
- 可达性：自定义模式控件保留 combobox/listbox 语义，选项提供 `aria-selected`，全局焦点环和 reduced-motion 规则继续有效。

## 边界与验收

- 不改 API、数据库、IPC、候选采纳、revision、Provider 数据结构或持久化语义。
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:run`（94 个文件 / 390 个测试）
- [x] `npm run build`（含 built-server smoke）
- [x] `npm run e2e`（7/7）
- [x] `git diff --check`
- [x] 1440×960、1024×768、390×844；工作流模式菜单；键盘焦点；reduced-motion；无横向溢出。
