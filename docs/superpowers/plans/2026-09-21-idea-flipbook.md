# 灵感册翻页交互记录

日期：2026-09-21

## 参考与取舍

本轮公开参考了 [Turn.js](https://turnjs.com/) 的轻量书页模型、[StPageFlip](https://nodlik.github.io/StPageFlip/docs/classes/pageflip.html) 的翻页 API 语义，以及 [PDFlipbook](https://github.com/SympleNZ/PDFlipbook) 对响应式、键盘翻页、懒加载和 reduced-motion 的处理方向。

没有引入翻书依赖，也没有复制这些项目的源码或视觉。小奕这里只需要承载 3–8 个创作预设，因此采用本地 CSS 3D 封面 + 双页 spread：封面打开后显示预设目录与当前写法，上一/下一页切换时给当前页轻量翻页过渡；移动端改为单列，保留同一信息层级。

## 本地实现

- 删除首页原来的“快速起步”横向 chip 带，替换为 `PresetFlipbook` 灵感册。
- 封面支持点击/触摸/键盘打开；打开后支持 `←` / `→` 翻页、预设目录直接跳页、采用当前写法、保存为预设。
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
- [x] 真实浏览器视觉回看：封面、双页、目录、采用、键盘/移动降级路径可用。
