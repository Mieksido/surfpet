# 架构（v0.2）

一句话：**代码只认识「角色」这个概念，不认识「小肥鱼」这个具体形象。** 所有形象差异都放在皮肤包里。

```
┌──────────────────────────────────────────────────────────┐
│ 宿主 Host（Electron main）                                │
│ 透明置顶窗 / 托盘 / 右键菜单 / 拖拽 / 吸附 / 单实例        │
│ 只做窗口与系统层的事，不参与角色逻辑                        │
└───────────────┬──────────────────────────────────────────┘
                │ 皮肤数据（manifest + PNG + mask）
┌───────────────▼──────────────────────────────────────────┐
│ 交互层 Interaction（renderer/index.ts）                    │
│ 指针事件 → 命中测试 → 区域语义 → 手势（摸/戳/拖/右键）      │
│ 光标切换、摸摸判定、拖拽阈值                                │
└───────────────┬──────────────────────────────────────────┘
                │ hitTest / regionAt / playCommand
┌───────────────▼──────────────────────────────────────────┐
│ 骨骼层 Rig（renderer/rig.ts）                              │
│ RigAdapter 接口：layered（当前）/ sprite / live2d（预留）    │
│ 呼吸、眨眼、视线、说话、摸摸、拖拽形变                       │
│ 锚点、参数全部从 manifest.rigOptions 读，缺省有默认值        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 服务层 Services（main/surfcore.ts + main/chat-host.ts）    │
│ 角色/记忆/目的由 SurfCore 提供；桌宠只管窗口、消息与播放   │
│ SurfCore：/dsh-surfcore/pet-api/*（host.json 发现 + 令牌） │
│ chat-host：气泡 + 对话框 + 语音 + 「回复」跳转              │
└──────────────────────────────────────────────────────────┘
```

> 对话/语音/主动搭话的完整协议、事件游标与排障见 [`CHAT.md`](CHAT.md)。

## 三个契约

### 1. 皮肤包契约（数据 → 引擎）

| 字段 | 作用 | 缺省行为 |
|---|---|---|
| `canvas` / `display.scale` | 画布尺寸与显示缩放 | 必填 |
| `hitbox` | 粗命中矩形（性能早退） | 必填 |
| `rigOptions` | 头/后发/嘴的枢轴、眼睛中心、动作幅度 | 全部有默认值 |
| `interaction.mask` | 灰度命中遮罩（白=可命中），跟轮廓走 | 退回 hitbox 矩形 |
| `interaction.regions` | 语义区（头/身/鳍…）+ 手势 + 光标 | 全部按 `poke` 处理 |
| `interaction.menu` | 右键菜单项 id 列表 | 用内置默认项 |
| `layers[].role` | 行为钩子（眼睛/嘴/发…） | 未知 role 按 `group` 静态渲染 |

**新增一套皮肤 = 新建一个目录 + 一份 manifest，不改一行代码。**

### 2. 交互契约（指针 → 动作）

```
pointermove
  ├─ hitTest(x,y)         遮罩采样，决定「能不能点」→ 决定窗口穿透开关
  ├─ regionAt(x,y)        头 / 身 … 语义区
  ├─ cursorAt(x,y)        命中即手型光标；拖拽中变 grabbing
  ├─ gesture=pat 区域     累计蹭动位移 → 触发「摸摸」
  └─ hoverCloseEyes 区域  光标停留 >100ms → 慢慢闭眼（离开渐开）

pointerdown/up
  ├─ 位移 > 4px  → 拖拽（通知 main 跟手 + 松手吸附）
  └─ 位移 ≤ 4px  → 点她（头部=摸摸，其它=戳一下）

contextmenu
  └─ 只对命中区域响应，菜单项来自 manifest.interaction.menu
```

### 3. 动作契约（命令 → 骨骼）

`rig.playCommand(id)` 是唯一入口，当前支持：
`blink / talk / talk-start / talk-stop / mouth / hop / pat / wag / tailpet / poke`。

新动作只需要：在 rig 里加一个字段 + 在 `playCommand` 里挂一行；**形状和时长以后会数据化到 manifest 的 `motions/`**，届时皮肤可以自带动作曲线。

## 为什么这么分

- **可替换**：换皮肤不动代码；换渲染方式（layered → live2d）只换 RigAdapter。
- **可测试**：交互是纯函数（坐标 → 命中/区域/光标），`npm run selftest` 能直接断言。
- **安全**：皮肤是纯数据，不执行 JS；右键菜单只认白名单动作 id。
- **向下兼容**：旧 manifest（schema 1）缺 `rigOptions` / `interaction` 也能跑，全部走默认值。

## 皮肤清单（新形象照着填）

1. `skins/<id>/art/*.png`：同画布、同位置、透明底；
2. `mask.png`：256×256 灰度，白=可命中（可从合成图 alpha 生成）；
3. `manifest.json`：`canvas`、`display.scale`、`hitbox`、`rigOptions`、`interaction`、`layers`；
4. `persona.md`：人设（由 SurfCore 角色系统读取；桌宠不直接读）；
5. 可选：`preview.png`、`LICENSE-ART.md`。

## 下一步扩展点（已留位）

- `rig: "sprite"`：序列帧适配器（同一套交互与 manifest，只换渲染）
- `rig: "live2d"`：Cubism 适配器（`rigOptions` 的 pivots 可忽略）
- `interaction.regions` 增加 `fin`（摸鱼鳍）、`tooltip`（悬停气泡）
- `motions/`：皮肤自带动作曲线（呼吸幅度、摸摸节奏）
- 气泡层 / 粒子层（爱心、zzz）挂在 root 之上的独立容器
- 对话输入：语音输入（ASR）+ 口型同步（现在只有 TTS 回复与 `talk` 动画）
