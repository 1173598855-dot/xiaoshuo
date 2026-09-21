# 鼠标交互优化记录

日期：2026-09-21

## 参考

参考 [Vibe Hub Hover 交互说明](https://vibe-hub.org/en/hover)：hover 只做轻量的颜色/阴影/位移提示，过渡保持稳定；鼠标提示不能成为触摸或键盘用户获取核心操作的唯一方式。

## 本地实现

- `CursorGrid` 增加跟随指针的紫色空间光晕，保留原有网格唤醒作为第二层反馈。
- 点击时增加短促的扩散脉冲，提示当前交互发生的位置。
- 光晕只在 `hover: hover` + `pointer: fine` 的设备显示；触摸端不依赖 hover。
- `prefers-reduced-motion: reduce` 下关闭光晕和脉冲；按钮原有 hover 与 focus-visible 状态继续可用。
- 没有复制 Vibe Hub 的颜色、品牌或源码，只采用通用 pointer feedback 语义并使用小奕现有紫色 tokens。

