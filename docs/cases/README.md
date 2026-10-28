# 桌宠 bug 案例索引

> 和主仓库同一套规矩：**修完一个 bug 必须写 case 并在这里登记**。
> 模板见 [`_TEMPLATE.md`](_TEMPLATE.md)；SurfCore 侧的案例在
> [surfcore/docs/cases](https://github.com/Mieksido/surfcore/tree/main/docs/cases)。

| 日期 | 案例 | 一句话 | 版本 |
| --- | --- | --- | --- |
| 2026-10-27 | [拖拽永不结束](2026-10-27-drag-never-ends.md) | 指针离开窗口后收不到 `pointerup`，她一直跟着鼠标动 | v0.2.1 |
| 2026-10-27 | [125% 缩放拖动漂移](2026-10-27-drag-drift-dpi.md) | `setPosition` 在缩放屏上让窗口每帧变大 | v0.2.2 / v0.2.3 |
| 2026-10-28 | [卸载丢聊天记录](2026-10-28-uninstall-data-loss.md) | 卸载直接删安装目录，`data/` 一起没了 | SurfCore v0.6.4 |
