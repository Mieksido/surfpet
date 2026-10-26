# 皮肤包规范（schema 2）

一套皮肤 = 一个目录 `skins/<id>/`，**纯数据**，不会被 `import` 或执行。

```
skins/<id>/
  manifest.json     必需
  mask.png          推荐：256×256 灰度命中遮罩（白=可命中）
  preview.png       可选：64×64 缩略图
  art/*.png         必需：同画布、同位置的分层图
  persona.md        可选：人设（M2 起使用）
  LICENSE-ART.md    建议：素材授权
```

## manifest.json

```jsonc
{
  "schema": 2,
  "id": "feiyu-01",
  "name": "小肥鱼",
  "author": "you",
  "version": "0.2.0",
  "rig": "layered",

  "canvas": { "w": 1024, "h": 1024 },
  "display": { "scale": 0.44 },
  "hitbox": { "x": 205, "y": 95, "w": 630, "h": 929 },

  "rigOptions": {
    "headPivot": [556, 512],
    "backHairPivot": [512, 320],
    "mouthPivot": [579, 442],
    "gazeCenter": [586, 392],
    "eyeCenters": { "l": [648, 411], "r": [524, 374] },
    "motion": { "breath": 0.011, "sway": 0.008, "headTurn": 16, "gazeMax": [6, 4.5] }
  },

  "interaction": {
    "cursor": "pointer",
    "mask": "mask.png",
    "maskSize": [256, 256],
    "sounds": { "potHit": "sfx/pot-hit.wav" },
    "regions": [
      { "id": "pot", "gesture": "pat", "cursor": "pointer", "sound": "potHit",
        "shape": { "type": "ellipse", "cx": 650, "cy": 425, "rx": 345, "ry": 160 } },
      { "id": "head", "gesture": "pat", "cursor": "pointer", "hoverCloseEyes": true,
        "shape": { "type": "ellipse", "cx": 596, "cy": 320, "rx": 200, "ry": 200 } },
      { "id": "body", "gesture": "poke", "cursor": "pointer",
        "shape": { "type": "rect", "x": 240, "y": 480, "w": 560, "h": 544 } }
    ],
    "menu": ["pat", "poke", "hop", "blink", "talk", "separator", "recenter", "hide", "quit"]
  },

  "layers": [
    { "id": "face", "file": "art/09_face.png", "group": "head", "role": "face" }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|---|---|
| `canvas` | 所有分层图必须严格同尺寸、同位置（画布对齐） |
| `display.scale` | 画布到屏幕的缩放；1024 画布建议 0.4–0.5 |
| `hitbox` | 粗命中矩形（画布坐标），先做早退 |
| `rigOptions` | 骨骼锚点与动作幅度；**不填就用默认值**，新皮肤可以只给 `art` 先跑起来 |
| `interaction.mask` | 精确命中遮罩；没有就退回 `hitbox` 矩形 |
| `interaction.regions` | 语义区，决定手势与光标；`shape` 支持 `ellipse` / `rect`；数组越靠前越优先 |
| `interaction.sounds` | 音效表：id → 皮肤目录内的音频（wav / ogg / mp3），启动时预加载 |
| `regions[].sound` | 点击（按下后不拖动就松开）该区域时同步播放的音效 id |
| `interaction.hoverCloseEyes` | 全局默认：光标停在角色上是否闭眼（默认关；`pat` 区默认开） |
| `regions[].hoverCloseEyes` | 单个区域覆盖上面的默认值 |
| `interaction.menu` | 右键菜单项 id，见下表 |
| `layers[].group` | `body` 跟身体动，`head` 跟头部动 |
| `layers[].role` | 行为钩子，见下表 |

### 动作 / 菜单 id

`pat`（摸摸）`poke`（戳）`hop`（跳）`blink`（眨眼）`talk`（说话）
`recenter`（回右下角）`hide`（隐藏）`quit`（退出）`separator`（分隔线）

未知 id 会被忽略，不会报错。

### 音效

- 只响在「点一下」（pointerdown → pointerup 中间没拖动），拖动、蹭摸都不触发；
- 一个音效预加载 3 个 `<audio>` 实例轮着用，连点会叠着响，不会打断上一声；
- renderer 是 `file://` 页面，**不能用 fetch/XHR 读本地音频**（会被拦），所以走 `<audio preload="auto">`；
- 文件放在皮肤目录里（如 `skins/<id>/sfx/pot-hit.wav`），manifest 里写相对路径；
- CSP 默认允许 `file:` 与 `'self'`，媒体元素不需要额外放行。

### 支持的 role

| role | 行为 |
|---|---|
| `hair.back` | 独立容器，跟随身体反向轻摆 |
| `mouth` | 嘴部主图层；配合 `rigOptions.mouth` 做张嘴/闭嘴（没有配置时保持原图） |
| `eye.white.<l/r>` | 眨眼淡出 |
| `eye.iris.<l/r>` | 眨眼淡出 + 视线跟随 |
| `eye.lash.<l/r>` | 眨眼下移 26px 形成闭眼线 |
| `brow.<l/r>` | 随眨眼/视线微动 |
| `face` `nose` `headwear` `hair.front` | 跟头部动 |
| 其它 | 跟身体动 |

### 嘴部动作（`rigOptions.mouth`）

所有皮肤都可以在 `rigOptions` 里加一段 `mouth`，让「张个嘴」/ 说话时嘴动起来。
`rigOptions.mouthTalk: true` 是旧版字段，只做轻微缩放；新皮肤请用 `mouth`。
如果原嘴是一整条闭合线（不是圆嘴洞），张嘴时叠加 `open` 会看出两张嘴，加 `hideBase: true` 把原嘴整层收掉。

**A. 原图是闭嘴（03 / 05 这种）** —— 说话时淡入一张画好的嘴洞，并用补丁盖住原来的嘴线：

```jsonc
"mouth": {
  "rest": "closed",
  "open": "art/10_mouth_open.png",        // 透明底，只画张开的嘴
  "openPivot": [646, 648],                // 嘴洞的缩放中心（画布坐标）
  "openRotation": -5,                     // 可选：嘴洞固定旋转（度，负值=逆时针）
  "openCover": "art/10_mouth_open_cover.png" // 可选：原嘴图层去线后的补丁
}
```

- `open` 与皮肤其它图层同画布、同位置；透明底。
- `openCover` 的 alpha 必须与原 `mouth` 图层一致，只把闭合线条擦掉；这样交叉淡入时不会出现色块。
- 嘴洞会以 `openPivot` 为中心纵向从 18% 长到 100%；`openRotation` 是固定的额外旋转（03 用 `-5`）。

**B. 原图是张嘴（02 / 04 这种）** —— 不额外画素材，说话时把嘴层纵向压扁来闭嘴：

```jsonc
"mouth": { "rest": "open", "squashMin": 0.28, "squashRotation": -10, "squashOffset": [0, 3] }
```

- 静息保持原图的张嘴笑；说话时嘴层在 `squashMin`（闭）和 1（张）之间循环。
- `squashRotation`：压到最闭时额外转多少度（正值=屏幕上顺时针，张开时回到 0）。
  02 用 `-10`（逆时针），04 用 `+5`（顺时针），把压出来的闭嘴线掰到和脸的朝向一致。
- `squashOffset`：压到最闭时额外平移多少画布像素（正值=右下，张开时回到 0）。
  02 用 `[0, 3]`，闭嘴时嘴唇再往下一点点。
- 嘴层里带的肤色/奶油色衬底会一起压扁；只要和脸的颜色接近，小尺寸下看不出来。

**C. 嘴是 w 型、脸鼓鼓的（01 元气皮肤）** —— 张嘴时把 w 闭嘴边整层收掉，留一张完整的张嘴，不做任何脸型收缩：

```jsonc
"mouth": {
  "rest": "closed",
  "open": "art/11_mouth_open.png",   // 透明底；单独一张完整的张嘴（口腔 + 舌头）
  "openPivot": [579, 467],           // 以口径最低点为中心向下张开
  "openOffset": [-3, -4],            // 张嘴素材整体往左上挪一点，上唇贴住闭嘴边原来的位置
  "openRotation": 15,                // 顺时针 15°，跟着脸的朝向调
  "hideBase": true                   // 张嘴时把原 w 嘴线整层收掉
}
```

- `hideBase: true`：`mouth` 图层的 w 是**完整的一条闭嘴线**，叠在张开的嘴上面会读成「两张嘴」。
  开启后原嘴随张嘴进度淡出（比嘴洞更快），闭嘴时再淡回；上唇由 `open` 素材自己的上缘承担。
- `open` 只画口腔和舌头，不画 w 线；`openPivot` 放在口腔最低点，保证缩放时口腔只会往下长。
- `open` 的上缘按用户画的红线**截平**（截线写死在 `tools/mouth-art.py`，在张嘴素材的未旋转坐标里），
  侧边和底边也按红线**重画**（左侧鼓、底边更平、右壁更直），所以上唇是一条干净的直线，不再往上糊一层柔边。
- `openOffset` / `openRotation` 只作用于 `open` 素材：偏移是画布像素（负值=左上），旋转单位是度、正值=屏幕上顺时针；
  缩放/旋转轴跟着偏移一起平移。01 用 `(-3, -4)` + `15°`；角度再改的话上唇位置会跟着转。
- **不要给 01 加 `warp`**：脸型/脸颊收缩已经按用户要求移除，张嘴只动嘴，不动脸、不动头发。

嘴部动作由说话状态驱动：`talk-start` 进入持续说话（气泡展示 / 语音播放期间嘴一直按音节开合），
`talk-stop` 收嘴；`talk` 仍是一次性 2.6 秒演示，`mouth` 动作则完整演一遍张→停→闭。
调试时可以在 renderer 控制台用 `window.__rig.setMouthOverride(1)` 把嘴固定在张开状态。

### 命中遮罩怎么来

从所有层的 alpha 合成图缩到 256×256，二值化（alpha > 48）即可：

```python
from PIL import Image
base = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
for f in layers:
    base = Image.alpha_composite(base, Image.open(f).convert('RGBA'))
mask = base.getchannel('A').point(lambda v: 255 if v > 48 else 0).resize((256, 256))
mask.save('skins/<id>/mask.png')
```

## 美术要求

- 所有层**同一画布、同一位置**，不要逐层裁边；
- 透明底，不要混入背景或参考图；
- 眼睛拆三层（眼白/虹膜/睫毛）、左右分开；嘴、眉、前后发独立；
- 角色底部建议贴画布底边；
- 1024×1024 足够（屏幕显示约 400px 高，2× 屏清晰）。

## 加一套新皮肤（不改代码）

1. 建目录与 `art/`，按上面的规格放分层 PNG；
2. 生成 `mask.png`；
3. 复制一份 manifest，改 `id / name / display.scale / hitbox / rigOptions / interaction / layers[].file`；
4. 重启应用；之后会支持热切换（托盘 / 右键菜单里选皮肤）。

## 向后兼容

`schema: 1` 的旧 manifest 仍然能跑：缺 `rigOptions` 用默认锚点，缺 `interaction` 就按 `hitbox` 命中、光标用 `pointer`、右键菜单用内置默认项。
