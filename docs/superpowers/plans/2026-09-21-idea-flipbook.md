# 灵感册翻页交互记录

日期：2026-09-21

## 参考与取舍

本轮公开参考了 [Turn.js](https://turnjs.com/) 的轻量书页模型、[StPageFlip](https://nodlik.github.io/StPageFlip/docs/classes/pageflip.html) 的翻页 API 语义，以及 [PDFlipbook](https://github.com/SympleNZ/PDFlipbook) 对响应式、键盘翻页、懒加载和 reduced-motion 的处理方向。

没有引入翻书组件库，也没有复制这些项目的源码或视觉。小奕这里只需要承载 3–8 个创作预设，因此引入轻量 `three` runtime 自建书体：封面、书脊、纸页厚度和单页纸张都是真实几何体；封面打开后只显示当前一页，上一/下一页时当前纸张绕书脊翻走，再露出目标页。移动端保持单页阅读，WebGL 不可用时自动退回同语义的 DOM/CSS 降级层。

## 本地实现

- 删除首页原来的“快速起步”横向 chip 带，替换为 `PresetFlipbook` 灵感册。
- `ThreeBookModel` 使用 `Scene`、`PerspectiveCamera`、`Group`、`BoxGeometry` 与 `MeshStandardMaterial` 构造书体和纸页；Three.js 官方文档作为 API 依据。
- 封面用 `CanvasTexture` 绘制小奕自己的灵感册封面，书脊、纸边沟槽和灯光材质独立建模，视觉上与现有立体书架保持同一语言。
- Three.js 通过动态 import 只在灵感册真正打开时加载，首页首屏不提前初始化 WebGL；WebGL context 创建失败时隐藏 canvas，保留 DOM/CSS 书页降级。
- 封面支持点击/触摸/键盘打开；打开后每次只翻一页，支持 `←` / `→`、上一页/下一页边界、采用当前写法、保存为预设和合上后恢复当前页。
- 预设仍复用原有 localStorage、草稿自动保存和 `selectedPresetId` 语义，不改变创建作品请求。
- 封面关闭时书内隐藏控件不会进入辅助技术焦点；当前预设和保存入口仍在底部常驻可达。
- `prefers-reduced-motion: reduce` 下去除 3D/翻页动画，内容与操作保持完整。

## 验收

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test:run`（94 个文件 / 390 个测试）
- [x] `npm run build`（含 built-server smoke）
- [x] `npm run e2e`（7/7）
- [x] `git diff --check`
- [x] 真实浏览器视觉回看：封面、单页翻动、采用、键盘/移动降级路径可用。
