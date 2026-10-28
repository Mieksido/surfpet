# 2026-10-27 · 125% 缩放拖动漂移（越拖越大、越拖越远）

> 由用户提交的 bug 报告（含采样数据与代码对比）定位，作者据此复核。

## 现象

- Windows 11、**显示缩放 125%** 下长按拖动：窗口一边跟手一边「越拖越大」，视觉上离光标越来越远，并伴随图层闪烁；
- 100% 缩放下几乎看不出来；
- 实测：`376×405 → 467×504（10s）→ 732×744（30s）→ 1199×1212（60s）`。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 家庭中文版 |
| 屏幕 | 1536×864 逻辑 / 1920×1080 物理，**125%**（AppliedDPI=120） |
| 桌宠 | feiyu-pet 0.2.1 |
| Electron | 45.0.0 |
| GPU | RTX 3050 Ti Laptop |

## 根因

1. 拖动循环只用 `win.setPosition(x, y)`：**125%/150% DPI 下系统会顺手改窗口尺寸**（每帧 +1px）；
2. 窗口膨胀后左上角按右下角锚点外移 → 看起来像被「甩开」；
3. 拖拽期间没有钉住尺寸，也没有在 `resize` 里自愈。

> 报告里提到的「`clientX` 正反馈」在这套实现里不成立：渲染进程只发
> `dragStart/dragEnd`，定位由主进程轮询 `screen.getCursorScreenPoint()` 完成。

## 修法（v0.2.2 / v0.2.3）

1. `startDrag()`：先 `stopDrag()`（会清空 pin）**再**记录 `getBounds()` 的宽高；
2. 循环改 `win.setBounds({ x, y, width: pinW, height: pinH })`，一次 set 后校验，尺寸被改就 `setSize` 压回；
3. `win.on('resize')`：拖拽期间尺寸必须等于 pin，否则压回；
4. v0.2.3 追加：刷新 125Hz → 60Hz（减少透明窗口闪烁）；窗口钳制在显示器内（至少留 60px）；
5. `--selftest` 新增 `drag-size-pin`：模拟「拖拽中被系统改大 40px」，断言自愈。

## 验证

```
[selftest] drag-size-pin: true {"before":"461x491","after":"461x491"}
[selftest] snap-to-edge: true
```

用户数据：修复后真实拖拽 45 条采样，`req=375x404  got=376x404`，尺寸全程稳定。

## 遗留

- 多显示器不同 DPI（跨屏拖）尚未专项验证；
- 报告提出的 `screenX/screenY` 增量方案功能等价，暂不采用（主进程轮询更简单）。
