# 对话与气泡（和 SurfCore 联动）

> 2026-10-25 起，桌宠的「说话」不再由自己接 LLM：人设、记忆、目的都由 **SurfCore** 提供，
> 桌宠只负责**窗口、交互、播放**。这样 QQ / B站 / 桌宠是同一个角色、同一份衰减记忆，
> 也不会出现「桌宠和 QQ 同时收到一句主动搭话」。

## 1. 进程与窗口

```
┌──────────── SurfCore 插件（DSH 进程内）────────────┐
│ 人格卡 + 记忆卡 + 目的引擎                          │
│ /dsh-surfcore/pet-api/*   ← 本地令牌（host.json）   │
└───────────────▲────────────────────────────────────┘
                │ fetch（主进程，非渲染进程）
┌───────────────┴──────────── 桌宠 Electron ───────────────────────────┐
│ main.ts                                                              │
│  ├─ surfcore.ts   host.json 发现 / 长轮询 / 断线重连 / 游标          │
│  ├─ chat-host.ts  气泡/对话框窗口、消息、语音播放、回复跳转          │
│  ├─ chat/bubble 窗口（dialog.html / bubble.html，同一个 preload）     │
│  └─ renderer（PixiJS 形象）：说话动画由 talk 命令驱动                │
└──────────────────────────────────────────────────────────────────────┘
```

- 渲染进程**不直接联网**：所有请求都在主进程 `surfcore.ts` 里发，令牌不暴露给页面。
- 气泡/对话框也是独立 `BrowserWindow`（`transparent: true`、alwaysOnTop），共用一个 preload。
- 语音播放用 `<audio>` 直接拉带令牌的 wav 地址；主进程在整段消息期间维持 `talk-start` 状态，说完再 `talk-stop`。

## 2. 发现与鉴权

SurfCore 插件启动时（并每 2 分钟）写：

```json
// ~/.dsh/surfcore/pet/host.json
{ "version": 1, "baseUrl": "http://127.0.0.1:14293", "token": "<48 hex>", "api": "/dsh-surfcore/pet-api" }
```

- 桌宠从 `DSH_HOME`（默认 `~/.dsh`）下读这个文件；可用 `SURFCORE_PET_HOST` 覆盖路径。
- 所有请求带 `x-pet-token: <token>`；音频 URL 用 `?token=`。令牌文件 `host-token` 是 0600。
- 插件只接受 127.0.0.1 / localhost / ::1；写操作要 `application/json`。
- **不要**改成 `/dsh-surfcore/api/*`：那套是设置页的，DSH 会因为没有会话 Cookie 直接 401（PITFALLS #66）。

## 3. 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 探活 |
| GET | `/status` | 对话 / 语音 / 模型 / 在线 / 事件游标 |
| GET | `/config` | 角色名、字数上限、主动搭话载体与形式 |
| GET | `/history?limit=` | 历史（含语音回放地址） |
| POST | `/chat` | `{ text, modality }` → `{ reply, userMessage, latencyMs, voice }` |
| POST | `/chat/test` | 设置页测试：回复同时作为事件推给所有桌宠 |
| POST | `/focus` | `{ enabled, source }` → 写 `focus.json`，并推 `focus` 事件唤醒长轮询；返回 `{ focus }` |
| GET | `/events?since=&wait=&client=` | 长轮询事件（`proactive` / `reply` / `focus`） |
| GET | `/audio/<key>.wav?token=` | 语音 |

`modality`：`text` → 文字回复；`voice` → TTS 语音 + 文字（语音失败自动降级文字，返回 `voice.ok=false`）。

## 4. 事件协议（长轮询）

```json
// GET /events?since=12&wait=25000
{ "ok": true, "bootId": "a1b2c3d4e5f6", "cursor": 13,
  "events": [ { "id": 13, "type": "proactive", "text": "咪…", "modality": "voice",
                "audio": { "key": "…", "url": "/dsh-surfcore/pet-api/audio/….wav?token=…", "durationMs": 9000 } } ] }
```

- `type`：`proactive`（主动搭话，气泡带「主动来找你」）、`reply`（设置页测试的回复）或
  `focus`（专注模式开关，`enabled: true/false`）。
- **首次连接**（不带 `since`）只返回当前 `cursor`，不重放旧气泡。
- **插件重启**：`bootId` 变、事件序号从 1 重来。客户端发现 `bootId` 变化后用「不带 since」重新取水位；
  服务端看到 `since > eventSeq` 也会直接回当前水位 —— 否则旧游标会让客户端**永远收不到**新事件（PITFALLS #67）。
- 长轮询 25 秒超时返回空事件；断线 1.5s 起指数退避（最多 15s），并重读 `host.json`（端口漂移）。

## 5. 一条消息的完整路径

```
对话框输入 → window.pet.chat.send(text, mode)
  → IPC 'chat:send'（主进程）
    → POST /pet-api/chat { text, modality }
      → 插件：当前角色人格卡 + 记忆卡 + 目的 pending + 规则 → DSH llm
      → 语音模式再调 TTS（内容寻址缓存）
    ← { reply: { text, modality, audio } }
  → chat-host：记历史、给对话框广播 'chat:message'、气泡 showBubble()
  → 气泡：显示文字；有 audio 就自动播放；文本/语音都持续驱动 talk-start → talk-stop
  → 气泡「回复」→ openDialog(reply.modality)
```

- **气泡一定会显示文字**（语音也是），这是需求里的硬约束。
- **同一时间只允许一处出声**（回音修复）：
  - 对话框可见时，主进程发给气泡的 `autoplay=false`，语音由对话框播放；气泡只显示文字和播放按钮。
  - 对话框关掉 / 不可见时，气泡才自动播放。
  - 谁开始播放都会通知主进程暂停另一侧（`chat:audio-start` / `bubble:audio-start`）；
    打开对话框也会先暂停气泡。
- 气泡自动收起：`4.5s + 100ms/字` 与 `音频时长 + 3.5s` 取大，最多 30s；
  鼠标悬停暂停计时，但 60 秒硬上限。**新消息直接顶掉旧气泡**，不排队（否则悬停时后续消息会被堵死）。
- **说话动画**：`showBubble` 时进入 `talk-start` 持续状态，整句话期间嘴一直开合，说完 `talk-stop`。
  语音按音频时长（+0.6s 尾巴），文本按字数估一个时长（0.7s + 130ms/字，夹在 3–15 秒）；
  多条消息重叠时结束时间取最晚的一条。
- 对话框模式（文本/语音）持久化在 `settings.json` 的 `dialogMode`；气泡的「回复」会按消息自带的 `modality` 覆盖它。
- **专注模式**：桌宠右键/托盘菜单或 SurfCore 桌宠页切换，单一真相 `~/.dsh/surfcore/pet/focus.json`。
  开启后插件不发主动搭话（QQ 载体的桥接 tick 也读同一份），桌宠本地也丢弃迟到的 proactive 事件；
  用户主动发起的对话不受影响。状态变化通过 `focus` 事件即时推送，长轮询不用等超时。
- **记忆**：每次 `/chat` 成功，插件把「主人说的 / 她回的」两条 `platform=pet` 事件追加到
  `memory-inbox.jsonl`，由记忆卡维护器摄入（同一张衰减卡、同一套遗忘；`scope=pet` 默认不进 B站）。
  设置 → 桌宠 →「把桌宠对话写进记忆卡」可关。

## 6. 失败与边界

| 情况 | 表现 |
|---|---|
| 找不到 `host.json` / 连不上 | 对话框顶部红点 + 横幅「没连上 SurfCore」，可点「重连」；消息不会丢，重连后可重发 |
| 插件重启（bootId 变） | 自动重新取水位；重启瞬间的一条事件可能不重放（避免旧消息轰炸） |
| TTS 没启动 / 超时 | 气泡仍然出文字；对话框里该条没有语音按钮（插件返回 `voice.ok=false`） |
| 模型未就绪 | 发送失败，横幅显示原因；不会出现「假装发了」 |
| SurfCore 卡死 | 长轮询 40s 超时 → 重连退避；主进程不阻塞 UI |
| 点击穿透 | 只影响主窗口；气泡/对话框是普通窗口，不穿透（关闭按钮/回复按钮可点） |

## 7. 本地验收（开发）

```bash
npm run build
npm start
# 另开终端：用插件写的令牌直接打接口
TOKEN=$(node -p "require(require('os').homedir()+'/.dsh/surfcore/pet/host.json').token")
curl -H "x-pet-token: $TOKEN" http://127.0.0.1:14293/dsh-surfcore/pet-api/status
```

- `npm run selftest` 会打开一个演示气泡 + 对话框并截图（`out/selftest/20-bubble.png` / `21-dialog.png`），
  不经过模型。
- 想验真实对话：在 SurfCore 设置 → 目的 → 「发一句试试」，回复会作为 `reply` 事件弹到气泡/对话框。
- 主进程排障可以临时加 `--remote-debugging-port=9228`，用 CDP 截图/取 DOM；
  这只是开发手段，**不要**写进启动参数或写死在 `surfcore.ts` 里。

## 8. 与 SurfCore 的分工

| 归桌宠 | 归 SurfCore |
|---|---|
| 窗口/气泡/对话框、消息列表、音频播放、说话动画 | 人设、记忆卡、目的状态、模型调用、TTS 合成、token 计量 |
| 连接/重连/事件游标、气泡自动收起 | 载体选择（桌宠 / QQ）、主动搭话的节奏与闸门 |
| 右键与托盘入口 | 设置页（桌宠安装/启动、目的栏目） |
