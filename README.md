# 小肥鱼桌宠 · surfpet

> 一个开源的 Windows 桌面宠物：透明置顶、点击穿透、可拖拽吸附，角色由分层插画驱动。
> 可以和 **SurfCore** 联动（文本/语音对话、气泡、主动搭话），不装 SurfCore 也能单独跑。

| | |
| --- | --- |
| 版本 | `0.2.0` |
| 平台 | Windows 10/11 |
| 许可 | MIT |
| 关联 | [SurfCore](https://github.com/Mieksido/surfcore)（插件侧） |

---

## 一、安装（用户）

**推荐：用 Release 的安装包**（不用装 Node、不用构建）。

1. 打开 [Releases](https://github.com/Mieksido/surfpet/releases) 下载 `pet-pack.zip`；
2. 确保本机有 `electron.exe`（没有就 `npm i -g electron` 或用 SurfCore 设置页里的下载提示）；
3. 在 SurfCore 的 **设置 → 桌宠**：
   - 填「Electron 路径」指向 `electron.exe`；
   - 「安装包地址」填刚下载的 zip（本地路径或链接）；
   - 点 **安装** → 再点 **启动**。

> 包是**纯资源 + 已构建的 JS**，不含 Electron 运行时。手动运行：
> `<electron.exe> . --no-sandbox`（在解压目录里）。

**没有 SurfCore 也能跑**：双击不了就手动 `electron .`，右键菜单会有「未连接到 SurfCore」的提示，但动效、皮肤、拖拽都正常。

---

## 二、从源码跑（开发者）

```bash
git clone https://github.com/Mieksido/surfpet.git
cd surfpet
npm install
npm run build      # 编译 src → dist
npm start          # 启动（Chromium sandbox 起不来时会自动加 --no-sandbox 重试）
```

调试：

```bash
npm run capture    # 截图（带模拟桌面背景）→ out/preview.png
npm run selftest   # 跑一遍动效并逐帧截图 → out/selftest/
npm run pack       # 打包成 pet-pack.zip（发版用）
```

---

## 三、和 SurfCore 联动

她的人设、记忆、主动搭话都来自 SurfCore（同一套人格卡 + 衰减记忆卡 + 目的机制）：

- **右键 → 文本对话 / 语音对话**；
- **右键 → 专注模式**：暂停自动主动搭话（桌宠与 QQ 载体都停），你主动打开对话仍可用；
- **气泡**：她说的每句话都会显示，带「回复」按钮（点它按那句话的形式打开对话）；
- **语音路由**跟随 SurfCore 的本地/云端选择，切换后不用重启桌宠；
- **连接发现**：从 `~/.dsh/surfcore/pet/host.json` 读本机接口（端口漂移自动重读），走本地令牌接口。

细节见 [`docs/CHAT.md`](docs/CHAT.md)。

---

## 四、皮肤与结构

五套皮肤（`feiyu-01` ~ `feiyu-05`），右键「穿什么呢」即时切换。

> 皮肤素材（`skins/`）体积大，**不进本仓库**；它们随 Release 的 `pet-pack.zip` 分发。
> 想自己加皮肤：把素材放进安装目录的 `skins/<id>/`，格式见安装包里自带的 `skins/CATALOG.md`。

代码结构：

```
src/main/main.ts        主进程：窗口/托盘/拖拽/吸附/点击穿透/皮肤加载/对话入口
src/main/surfcore.ts    SurfCore 连接层：host.json 发现、长轮询、断线重连、游标
src/main/chat-host.ts   气泡 + 对话框窗口、消息、语音播放、「回复」跳转
```

---

## 五、发版（维护者）

```bash
npm run pack
node scripts/make-manifest.mjs --version 0.3.0 --file artifacts/pet-pack.zip --notes notes.md --owner Mieksido --repo surfpet
# 把 pet-pack.zip 和 version.json 都上传到 Release
```

SurfCore 的「检查更新」会读 `version.json` 比对版本号，然后下载 zip → 校验 sha256 → **保留 `data/`** 地替换。

---

## 六、许可

MIT。第三方素材/字体各自遵循其许可（见 `assets/` 目录内说明）。

## 踩坑记录

- 拖拽失效 / DPI 漂移 / 卸载丢数据等案例，见 [`docs/cases/`](docs/cases/README.md)。
