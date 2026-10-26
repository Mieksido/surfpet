# 小肥鱼桌宠 · 规划稿（v0.1）

> 状态：仅规划，未开工。路线 A（独立 Electron 桌宠）。
> 目标读者：你（产品/美术/决策）+ 我（实现）。

---

## 1. 目标与非目标

### 目标
1. **陪伴**：透明置顶桌宠，会呼吸、眨眼、跟随鼠标、拖拽、贴边吸附、待机小动作、点击互动。
2. **能聊天**：气泡对话，多 LLM Provider 可切换（DeepSeek / 任意 OpenAI 兼容 / 本地 Ollama）。
3. **能语音**：TTS 说话 + 口型同步；ASR 语音输入（先按键说话，后唤醒词）。
4. **能干活**：可绑定 QQ（回消息）与 B 站（陪看 / 受控操作），动作走「工具系统」，默认需确认。
5. **可切换**：3–4 个角色，每个角色 = 皮肤 + 人设 + 音色 + 独立记忆；LLM 模型全局可切、也可按角色覆盖。
6. **开源**：MIT 代码；皮肤包为纯数据，可被社区制作与分发。

### 非目标（明确不做）
- 不做 QQ 协议逆向、不内置任何 QQ 客户端二进制（复用你本机的 SnowLuma OneBot 接口）。
- 不做自动批量刷视频 / 自动评论 / 自动关注（风控与骚扰风险）。
- 不做云端账号体系、不做移动端、不做直播推流。
- 不做「可扩展应用」形态的 Live2D 模型商店（会触发 Live2D 发行许可的额外签约条款）。

---

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 壳 | Electron（最新稳定版，lockfile 固定） | 透明窗/置顶/托盘/多屏生态最成熟；Web 渲染便于做皮肤与设置 UI |
| 语言 | TypeScript（strict） | 工具系统与皮肤 schema 需要类型约束 |
| UI | React + Zustand | 设置面板、气泡、皮肤工作室 |
| 渲染 | PixiJS（WebGL） | 2D 骨骼/序列帧/伪 Live2D 统一在一个渲染器里 |
| Live2D | Cubism Web SDK（可选适配器） | 有绑定好的模型时直接吃 `.model3.json` |
| 存储 | SQLite（better-sqlite3）+ JSON 配置 | 记忆/审计/用量要能查、能导出 |
| 密钥 | Electron `safeStorage`（DPAPI） | 不明文落盘 |
| 打包 | electron-builder（NSIS + portable） | 开源分发友好，GitHub Releases 自动更新 |
| 测试 | Vitest + Playwright(Electron) | 策略引擎/Provider 单测；窗口行为 e2e |
| 协议 | OneBot v11（HTTP 3000 / WS 3001） | SnowLuma 已在本机跑通，账号「示例小肥鱼」在线 |

内存预期：空闲 150–250MB；CPU 空闲 < 2%（30fps 上限 + 遮挡暂停）。

---

## 3. 进程与模块

```
┌──────────────────────── main (Node) ────────────────────────┐
│ window-manager  tray  autostart  hotkeys  updater            │
│ secrets(safeStorage)  logger  ipc-bridge                     │
│                                                              │
│  agent-core ── llm(providers) ── memory(sqlite)              │
│      │        └ tts/asr pipeline ── audioserver              │
│      └ tool-registry ── policy-engine ── audit-log           │
│                                                              │
│  integrations: onebot-client | bili-controller               │
└───────────────┬──────────────────────────┬───────────────────┘
                │ IPC (typed, contextBridge)│
┌───────────────▼──────────────┐  ┌────────▼──────────────────┐
│ pet-window (renderer)        │  │ settings-window (renderer) │
│  rig-adapter: layered|sprite │  │  provider/skin/voice/QQ/B站 │
│  |live2d|vrm                 │  │  皮肤工作室 / 日志查看       │
│  bubble / lip-sync / fsm     │  └───────────────────────────┘
└──────────────────────────────┘
```

要点：
- **渲染进程无 Node**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，只暴露白名单 IPC。
- **agent-core 跑在 main 的 worker_threads**，避免 LLM 流式/音频阻塞窗口。
- **皮肤包是数据**：不执行任何 JS，杜绝「装个皮肤被投毒」。

---

## 4. 核心接口

```ts
interface RigAdapter {
  load(skin: SkinManifest, host: PixiContainer): Promise<void>;
  setParam(name: string, value: number): void;      // 统一参数名，跨 rig 映射
  play(motion: MotionName, opts?: { loop?: boolean }): Promise<void>;
  setExpression(expr: string): void;
  setLipSync(amplitude: number): void;              // 0..1，TTS 驱动
  setGaze(x: number, y: number): void;              // -1..1，跟随鼠标
  hitTest(x: number, y: number): boolean;           // 命中区（决定穿透）
  dispose(): void;
}
```

统一参数集（各 rig 自行映射）：
`breath, bodyAngleX/Y, headAngleX/Y/Z, eyeOpenL/R, eyeBallX/Y, mouthOpen, mouthForm, browL/R, tailSwing, finL/R, blush`

```ts
interface Tool {
  name: string;                 // "qq.reply"
  description: string;
  schema: JSONSchema;           // 参数
  risk: "read" | "write" | "external";
  confirm: "never" | "once" | "always";
  rateLimit?: { perMinute: number };
  run(args: unknown, ctx: ToolCtx): Promise<ToolResult>;
}
```

内置工具（v1）：
`qq.read / qq.reply / qq.react`、`bili.open / bili.search / bili.playback / bili.like / bili.favorite / bili.danmaku`、`pet.say / pet.emote / pet.sleep`、`sys.notify / sys.openUrl / sys.screenshot`。

---

## 5. 皮肤包规范（关键，先定死）

```
skins/<id>/
  manifest.json
  preview.png
  art/
    body.png  head.png  eye_l_open.png  eye_l_closed.png
    eye_r_open.png  eye_r_closed.png
    mouth_closed.png  mouth_open.png  mouth_smile.png
    tail.png  fin_l.png  fin_r.png  blush.png  accessory/*.png
  motions/
    idle.json  tap.json  drag.json  sleep.json  eat.json  speak.json
  audio/
    tap.mp3  eat.mp3  voice-preview.mp3
  LICENSE-ART.md          # 素材授权（开源项目必填）
```

```jsonc
{
  "schema": 1,
  "id": "feiyu",
  "name": "小肥鱼",
  "author": "you",
  "version": "0.1.0",
  "rig": "layered",                 // layered | sprite | live2d | vrm
  "canvas": { "w": 1024, "h": 1024, "anchor": [0.5, 0.98], "scale": 1 },
  "hitboxes": [{ "x": 0.1, "y": 0.2, "w": 0.8, "h": 0.7 }],
  "parts": {
    "body": "art/body.png",
    "head": "art/head.png",
    "eyes": { "l": ["art/eye_l_open.png", "art/eye_l_closed.png"],
              "r": ["art/eye_r_open.png", "art/eye_r_closed.png"] },
    "mouth": { "closed": "art/mouth_closed.png", "open": "art/mouth_open.png" },
    "tail": "art/tail.png"
  },
  "motions": { "idle": "motions/idle.json", "tap": "motions/tap.json" },
  "persona": { "name": "小肥鱼", "prompt": "persona/feiyu.md", "voice": "edge:zh-CN-XiaoyiNeural" },
  "license": { "code": "MIT", "art": "CC-BY-NC-4.0", "source": "https://..." }
}
```

**rig 四种**：
- `layered`（主推）：你只给分层 PNG，我用「部件 + 弹簧 + 网格」做伪 Live2D，不需要绑定师。
- `sprite`：序列帧，最省事但要画很多帧。
- `live2d`：有绑定好的模型直接吃，效果最好、成本最高。
- `vrm`：3D，二期可选。

---

## 6. 角色 / 模型切换

- **角色（Character）** = 皮肤 + 人设 prompt + 音色 + 记忆命名空间 + 默认模型。
  切换即换皮、换声音、换记忆，QQ 回复也换人格。
- **模型（LLM）** = Provider 配置（baseURL / model / key 引用 / 温度 / 上限）。
  全局默认一份；每个角色可覆盖。
- 会话上下文按 `characterId + channel(desktop|qq:<id>|bili)` 分桶；切换不丢上下文。
- 记忆分层：短期（最近 N 轮）→ 摘要（每 20 轮压缩）→ 长期（事实卡片，可手动编辑/删除）。

---

## 7. 语音链路

```
按键/唤醒 → VAD → ASR → LLM 流式 → 分句 → TTS(逐句) → 播放队列 → 口型幅度
                                    └→ 气泡逐字显示（与语音同步）
```

- **TTS 默认**：Edge TTS（免 key，零配置，可能失效）→ 抽象层可换 Azure / GPT-SoVITS / IndexTTS（本地 HTTP）。
- **ASR 默认**：whisper.cpp 本地（免 key，需下载 100–500MB 模型）→ 可换云端。
- **口型**：TTS 播放时的实时幅度 → `setLipSync()`；中文不做 viseme，只做开合 + 表情配合，性价比最高。
- **打断**：说话时检测到用户开口 → 立即停 TTS（barge-in）。
- **延迟预算**：ASR 0.3s + 首 token 0.8–1.5s + 首句 TTS 0.3s ≈ 1.5–2.5s，可接受。

---

## 8. Agent 与工具安全

三条铁律：
1. **默认拒绝**：工具注册表白名单之外一律不可调用。
2. **不可信输入隔离**：QQ 消息、B 站弹幕/标题都是**数据**，不进入系统指令通道；模型不能因为消息里写「忽略之前的指令」就去调工具。
3. **外发必确认**：`risk: external` 的工具（发 QQ、发弹幕、点赞）默认 `confirm: "always"`，桌面弹确认气泡；可对特定会话升为 `auto`，但要二次确认 + 频控。

其他：每条工具调用写审计日志（时间/工具/参数摘要/结果）；网络只允许配置过的域名；回复文本只能进 TTS/气泡，不能反过来触发工具。

---

## 9. QQ 集成（复用 SnowLuma）

现状（已确认）：SnowLuma 在线，账号 `1000000007`「示例小肥鱼」；OneBot v11 HTTP `127.0.0.1:3000`、WS `127.0.0.1:3001`，带 access token。

- 连接：WS 长连收事件（`message.group` / `message.private`），HTTP 兜底发消息；断线指数退避重连。
- **策略引擎**（配置化，默认保守）：
  - 范围：群白名单 + 私聊白名单（与 SnowLuma 的 allowlist 独立配置，双保险）
  - 触发：被 @ / 被叫名字 / 私聊 / 关键词 / 概率接管（默认 0）
  - 节奏：每会话冷却 60s、全局每分钟 ≤3 条、夜间 23:00–08:00 静默
  - 内容：敏感词过滤、不主动发群、不把私聊内容搬到群里、不复读
- **两种模式**：`draft`（默认，生成后等你点发送）/ `auto`（只对白名单会话开放）。
- 记忆：QQ 会话与桌面共用角色人格，但记忆分桶，避免串台。
- 合规提示：QQ 自动化存在账号风险，README 明确写「自担风险、不内置协议端」。

---

## 10. B 站集成

两种档位，先做低风险的那档：

| 档位 | 能力 | 风险 | 版本 |
|---|---|---|---|
| **陪看** | 内嵌浏览器窗打开 B 站，宠物站旁边；读取标题/进度/弹幕，实时吐槽、跟着笑、困了打哈欠 | 低（只读页面） | v1 |
| **受控操作** | 播放/暂停/下一个/搜索/点赞/收藏/发一条弹幕，每次确认 | 中（账号行为，可能风控） | v1.1 |
| 自动刷 | 自动连播/自动评论 | 高，不做 | — |

实现：`BrowserWindow`（独立分区持久化登录，扫码登录不碰 cookie 导出）+ preload 注入读取 `video` 状态；操作走 DOM 点击而非私有 API，降低风控特征。

---

## 11. 窗口与交互细节（最容易翻车的地方）

- 透明：`transparent: true, frame: false, backgroundColor: '#00000000'`，`alwaysOnTop`（`screen-saver` 级）、`skipTaskbar`。
- **穿透 + 拖拽**：默认整窗穿透（`setIgnoreMouseEvents(true, {forward:true})`），渲染进程实时 `hitTest` 鱼身；命中时切回可点。拖拽用自定义实现（`-webkit-app-region: drag` 与穿透互斥，不用它）。
- 吸附：屏幕边缘 24px 内吸附，多屏按 `screen.getAllDisplays()` 计算，显示器变更时重算。
- DPI：`devicePixelRatio` 变化重设画布；缩放 0.6×–2×。
- 托盘：显示/隐藏、切角色、切模型、静音、设置、退出；开机自启（登录项）。
- 快捷键：`Ctrl+Shift+F` 显隐、`Ctrl+Shift+Space` 按住说话。
- 节能：窗口被遮挡/最小化时暂停渲染；可切 15fps 省电模式。
- 多实例：单实例锁；桌宠窗永远不抢焦点（`focusable: false` 慎用，会影响输入，改用点击时临时聚焦）。

---

## 12. 数据与隐私

- 本地 SQLite：消息、记忆、审计、用量；提供「一键清空」与按会话删除。
- 密钥：`safeStorage` 加密；导出配置时默认剔除密钥。
- 默认无遥测；崩溃报告可选且默认关。
- 开源仓库不含任何个人素材/密钥/聊天记录；`.gitignore` 覆盖 `data/`。

---

## 13. 里程碑（含验收标准）

| 阶段 | 内容 | 验收 | 估时 |
|---|---|---|---|
| **M0 骨架** | 透明置顶窗 + 占位鱼 + 拖拽 + 穿透 + 托盘 + 设置壳 | 能在桌面拖动一只假鱼，点到桌面图标不挡 | 0.5 天 |
| **M1 Rig + 皮肤** | layered rig（呼吸/眨眼/摆尾/跟随鼠标/拖拽形变）+ 皮肤加载器 + 切换 UI + schema 校验 | 你的 1 号角色能动、能切到占位皮肤 | 3 天 |
| **M2 聊天** | Provider 抽象（OpenAI 兼容 + Ollama）+ 流式气泡 + 人设 + 记忆 + 模型切换 UI | 换 DeepSeek/Ollama 都能聊，切换不丢上下文 | 3 天 |
| **M3 语音** | Edge TTS + 分句队列 + 口型 + 按键 ASR + 打断 | 能按住说话、她出声回、嘴跟着动 | 3 天 |
| **M4 QQ** | OneBot 客户端 + 策略引擎 + 确认气泡 + 审计 + 频控 | 群里 @ 她会起草回复，你点一下才发 | 4 天 |
| **M5 B站** | 内嵌 B 站窗 + 状态读取 + 陪看吐槽 + 受控操作 | 她能看到你在看什么并接话 | 4 天 |
| **M6 发布** | 打包 NSIS/portable + 自动更新 + 文档 + 皮肤规范 + CI | 别人 clone 后能跑起来、能装 | 2 天 |

合计约 **20 个开发日**（我这边）。3–4 个角色的美术与配音是并行线，不占这 20 天。

---

## 14. 你要准备的东西

### A. 美术（3–4 个角色，每个）
- 全身立绘 PNG，透明底，高 ≥ 2000px；
- **最好分层**（PSD）：身体 / 头 / 左右眼(睁/闭) / 嘴(闭/开/笑) / 尾巴 / 鳍 / 腮红 / 配饰；
  - 只有单张也行 → 走 `sprite` 或我帮你拆件（质量取决于原图，圆润的鱼最好拆）
- 表情差分 6–8 个（开心/困/生气/惊讶/委屈/满足/流口水/晕）；
- 姿势 2 个（站/趴）；
- 托盘图标（16/32/64）、应用图标（256/512，ico+png）；
- 每个角色的授权说明（开源要写清楚）。

### B. 声音
- 每个角色一个音色：现成 TTS 音色 ID，或 **10–30 秒干净人声**做 zero-shot 克隆（本地 GPT-SoVITS/IndexTTS）；
- 音效：点击、喂食、叹气、开心（可选，我可先用免费音效垫）。

### C. 文案
- 每个角色 200–500 字人设：性格、说话风格、口头禅、称呼你的方式、禁忌话题、回复长度偏好。

### D. 账号
- B 站账号（扫码登录，用于陪看/点赞/收藏）；
- QQ 由你本机 SnowLuma 承担（已在线），**不需要**额外准备；
- LLM：DeepSeek key（已有则复用），可选 Ollama。

### E. 决策（见第 16 节）

---

## 15. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 点击穿透与拖拽冲突 | 体验崩 | M0 先打通，命中区 + 自定义拖拽 |
| Electron 内存偏高 | 常驻不友好 | 遮挡暂停、30fps、可选省电模式；后续可评估 Tauri |
| Edge TTS 不稳定 | 语音失效 | 抽象层 + 本地 TTS 兜底 |
| QQ 自动化封号 | 账号风险 | 保守策略、频控、默认 draft、README 免责 |
| B 站风控 | 操作失败 | 只做 DOM 级操作、低频、默认陪看 |
| 提示词注入（QQ 消息） | 越权操作 | 输入隔离 + 工具白名单 + 外发确认 |
| 开源素材授权 | 法律风险 | 每个皮肤包带 LICENSE-ART.md，默认图不随仓库分发 |
| Live2D 授权 | 发行合规 | 自用不管；若公开发行按官方条款确认，不做「可扩展应用」 |

---

## 16. 待你拍板

1. **QQ 回复策略**：只回「@她 / 私聊」，还是白名单群也自动接话？默认 draft 确认流可以吗？
2. **B 站**：v1 只做「陪看吐槽」，受控操作放 v1.1 —— 接受吗？还是必须一开始就能点赞/收藏？
3. **声音**：用现成 TTS 音色，还是你要给她做专属音色（需 10–30s 参考音频）？
4. **图**：能给分层 PSD 吗？还是只有整张 PNG（决定走 layered 还是 sprite）？
5. **开源协议**：代码 MIT？美术素材单独协议（建议 CC-BY-NC 或保留所有权利）？
6. **平台**：只 Windows，还是之后要 macOS？
