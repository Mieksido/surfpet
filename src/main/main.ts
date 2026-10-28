import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { describeServices } from './services';
import { ChatHost } from './chat-host';

const SNAP_DIST = 28;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.0;
const MARGIN_X = 10;
const MARGIN_TOP = 40;

const isPreview = process.argv.includes('--preview');
const isSelftest = process.argv.includes('--selftest');
const wantPreview = isPreview || isSelftest;
const skinArg = process.argv.find((a) => a.startsWith('--skin='));
const actionArg = process.argv.find((a) => a.startsWith('--action='));
const captureArg = process.argv.find((a) => a.startsWith('--capture='));
const capturePath = captureArg ? captureArg.slice('--capture='.length) : null;

let win: BrowserWindow | null = null;
let slider: BrowserWindow | null = null;
let tray: Tray | null = null;
let chatHost: ChatHost | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let snapTimer: NodeJS.Timeout | null = null;
let inputPoll: NodeJS.Timeout | null = null;
let talkTimer: NodeJS.Timeout | null = null;
let talkUntil = 0;
let talking = false;
let dragOffset = { x: 0, y: 0 };
let debugIgnore = true;
let menuOpenCount = 0;
let pollPaused = false;
let skinCache: ReturnType<typeof loadSkin> | null = null;
let maskData: { w: number; h: number; bits: Uint8Array } | null = null;
let currentScale = 0.44;
let lastBubbleMove = 0;

function appRoot(): string {
  return app.getAppPath();
}

// 每个安装位置一个独立 profile（同一 app 名多份副本时不会互抢单实例锁）。
// 放 %APPDATA% 而不是安装目录：安装目录可能只读，或落在 Chromium 无法建锁文件的路径下（建锁失败会直接退出）。
if (!app.isPackaged) {
  const key = createHash('sha1').update(appRoot()).digest('hex').slice(0, 10);
  const candidates = [
    // 安装目录内的 profile 优先：安装目录一般可写，也天然按副本隔离
    path.join(appRoot(), 'data', isSelftest ? 'userdata-selftest' : 'userdata'),
    path.join(app.getPath('appData'), 'feiyu-pet', isSelftest ? `selftest-${key}` : key),
    path.join(os.tmpdir(), 'feiyu-pet', key),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // 真正写一个探针文件：某些受限环境里 mkdir 能过，但 Chromium 之后建锁会 EPERM
      fs.writeFileSync(path.join(dir, '.write-probe'), 'ok');
      fs.rmSync(path.join(dir, '.write-probe'), { force: true });
      app.setPath('userData', dir);
      break;
    } catch {
      /* 换下一个候选 */
    }
  }
}

// 单实例：第二个进程拿不到锁就直接退出，顺便避免磁盘缓存锁冲突导致的崩溃
const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) win.showInactive();
  });
}

/* ---------------------------------- 设置 ---------------------------------- */

interface Settings {
  scale: number;
  skin: string;
  /** 上次用的对话形式：下次右键「跟她说话」/气泡回复时默认用它 */
  dialogMode?: 'text' | 'voice';
  /** 本地缓存的专注模式；连上 SurfCore 后以插件的 pet/focus.json 为准 */
  focusMode?: boolean;
}

let settings: Settings = { scale: 0.44, skin: '' };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<Settings>;
    const scale = typeof raw.scale === 'number' ? raw.scale : 0.44;
    return {
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
      skin: typeof raw.skin === 'string' ? raw.skin : '',
      dialogMode: raw.dialogMode === 'voice' ? 'voice' : 'text',
      focusMode: raw.focusMode === true,
    };
  } catch {
    return { scale: 0.44, skin: '', dialogMode: 'text', focusMode: false };
  }
}

function persistSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('[settings] save failed', err);
  }
}

/* ---------------------------------- 皮肤 ---------------------------------- */

interface SkinEntry {
  id: string;
  name: string;
  dir: string;
}

function skinsDir() {
  return path.join(appRoot(), 'skins');
}

/** 每次调用都重新扫目录：用户丢一套新皮肤进来，菜单里立刻能看到 */
function listSkins(): SkinEntry[] {
  const dir = skinsDir();
  if (!fs.existsSync(dir)) return [];
  const out: SkinEntry[] = [];
  for (const id of fs.readdirSync(dir)) {
    const mf = path.join(dir, id, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      out.push({ id, name: m.name || id, dir: path.join(dir, id) });
    } catch {
      console.warn('[skin] bad manifest:', id);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function loadSkin() {
  const entries = listSkins();
  if (entries.length === 0) throw new Error('no skin found in skins/');
  const chosen = entries.find((e) => e.id === settings.skin) ?? entries[0];
  settings.skin = chosen.id;
  const manifest = JSON.parse(fs.readFileSync(path.join(chosen.dir, 'manifest.json'), 'utf8'));
  return {
    manifest,
    baseUrl: pathToFileURL(chosen.dir).href + '/',
    skinCount: entries.length,
    scale: currentScale,
    id: chosen.id,
    skins: entries.map((e) => ({ id: e.id, name: e.name })),
  };
}

function getSkin() {
  if (!skinCache) skinCache = loadSkin();
  return skinCache;
}

/** 换装：换缓存、换窗口尺寸、重载渲染进程；设置落盘 */
function switchSkin(id: string) {
  if (!win) return;
  if (getSkin().id === id) return;
  const oldHitH = getSkin().manifest.hitbox.h;
  settings.skin = id;
  skinCache = null;
  maskData = null;
  // 保持「屏幕上看起来一样高」：按两套皮肤的命中高度换算缩放
  const newHitH = getSkin().manifest.hitbox.h;
  if (oldHitH > 0 && newHitH > 0) {
    currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (oldHitH * currentScale) / newHitH));
    settings.scale = currentScale;
  }
  persistSettings();
  const { w, h } = computeWinSize(currentScale);
  const b = win.getBounds();
  win.setBounds({ x: Math.round(b.x + b.width - w), y: Math.round(b.y + b.height - h), width: w, height: h });
  console.log('[skin] switch ->', id, 'canvas:', getSkin().manifest.canvas, 'want:', w, h, 'now:', win.getBounds());
  chatHost?.onPetMoved();
  win.webContents.reload();
}

/**
 * 窗口尺寸 = 画布 × 缩放 + 边距，但不会超过桌面工作区。
 * 超过工作区时窗口封顶、角色按比例溢出裁切（200% 时她的上半身会在屏幕外）。
 */
function computeWinSize(scale: number) {
  const m = getSkin().manifest;
  const wa = workArea();
  const maxW = Math.max(240, wa.width - 24);
  const maxH = Math.max(240, wa.height - 24);
  return {
    w: Math.min(Math.round(m.canvas.w * scale) + MARGIN_X, maxW),
    h: Math.min(Math.round(m.canvas.h * scale) + MARGIN_TOP, maxH),
  };
}

/** 画布原点在窗口里的位置（与 renderer 的 layout() 保持一致） */
function rootOffsetFor(scale: number, w: number, h: number) {
  const skin = getSkin().manifest;
  const cw = skin.canvas.w * scale;
  const chh = skin.canvas.h * scale;
  // 与 renderer 一致：装得下脚底对齐，装不下过渡到头顶对齐
  const headroom = 40;
  const sFit = (h - headroom) / skin.canvas.h;
  const t = sFit > 0 ? Math.min(1, Math.max(0, (scale - sFit) / (0.35 * sFit))) : 0;
  const yBottom = h - chh;
  const yHead = headroom - skin.hitbox.y * scale;
  return { x: (w - cw) / 2, y: yBottom + (yHead - yBottom) * t };
}

function rootOffset(scale: number) {
  const { w, h } = computeWinSize(scale);
  return rootOffsetFor(scale, w, h);
}

/* ------------------------------- 命中（遮罩） ------------------------------- */

function ensureMask() {
  if (maskData) return;
  const m = getSkin().manifest;
  const rel = m.interaction?.mask;
  if (!rel) return;
  const p = path.join(appRoot(), 'skins', m.id, rel);
  if (!fs.existsSync(p)) return;
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return;
  const size = img.getSize();
  const bmp = img.toBitmap();
  const bits = new Uint8Array(size.width * size.height);
  for (let i = 0; i < bits.length; i++) bits[i] = bmp[i * 4] > 96 ? 1 : 0;
  maskData = { w: size.width, h: size.height, bits };
}

/** 窗口内坐标 → 是否命中角色轮廓（主进程自己算，不依赖渲染进程的鼠标事件） */
function hitAtWindow(localX: number, localY: number): boolean {
  const m = getSkin().manifest;
  const s = currentScale;
  // 用实际窗口尺寸算原点（Windows 有时会因取整把窗口调成 461×491）
  const b = win?.getBounds();
  const root = b ? rootOffsetFor(s, b.width, b.height) : rootOffset(s);
  const cx = (localX - root.x) / s;
  const cy = (localY - root.y) / s;
  const hb = m.hitbox;
  if (cx < hb.x || cx > hb.x + hb.w || cy < hb.y || cy > hb.y + hb.h) return false;
  ensureMask();
  if (!maskData) return true;
  const mx = Math.floor((cx / m.canvas.w) * maskData.w);
  const my = Math.floor((cy / m.canvas.h) * maskData.h);
  if (mx < 0 || my < 0 || mx >= maskData.w || my >= maskData.h) return false;
  return maskData.bits[my * maskData.w + mx] > 0;
}

/**
 * 轮询光标：决定窗口此刻是「可点」还是「穿透」。
 * 用轮询而不是渲染进程的 mousemove，是因为窗口处于穿透态时、且别的窗口有焦点时，
 * 转发进来的鼠标事件并不可靠 —— 那样会导致「必须最小化所有窗口才能点她」。
 */
function startInputPolling() {
  if (inputPoll) return;
  inputPoll = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (pollPaused) return;
    if (dragTimer) {
      setInteractive(true);
      return;
    }
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    let inside = false;
    if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) {
      inside = hitAtWindow(p.x - b.x, p.y - b.y);
    }
    setInteractive(inside);
  }, 16);
}

function setInteractive(v: boolean) {
  if (v === !debugIgnore) return;
  debugIgnore = !v;
  const p = screen.getCursorScreenPoint();
  const b = win?.getBounds();
  console.log('[input] interactive =', v, JSON.stringify({ cursor: p, bounds: b, scale: currentScale }));
  win?.setIgnoreMouseEvents(!v, { forward: true });
  win?.webContents.send('pet:input-mode', v);
}

/* ---------------------------------- 窗口 ---------------------------------- */

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function placeDefault() {
  if (!win) return;
  const wa = workArea();
  const { w, h } = computeWinSize(currentScale);
  win.setBounds({
    x: Math.round(wa.x + wa.width - w - 24),
    y: Math.round(wa.y + wa.height - h),
    width: w,
    height: h,
  });
  chatHost?.onPetMoved();
}

function createWindow() {
  const { w, h } = computeWinSize(currentScale);
  win = new BrowserWindow({
    width: w,
    height: h,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setBackgroundColor('#00000000');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  const query: Record<string, string> = wantPreview ? { preview: '1' } : {};
  win.loadFile(path.join(__dirname, 'index.html'), { query });
  win.once('ready-to-show', () => {
    placeDefault();
    win?.showInactive();
    startInputPolling();
  });

  win.on('closed', () => {
    win = null;
  });
}

/* --------------------------------- 调整大小 -------------------------------- */

function applyScale(next: number, persist = true) {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
  currentScale = scale;
  settings.scale = scale;
  if (persist) persistSettings();
  if (!win) return;
  const { w, h } = computeWinSize(scale);
  const b = win.getBounds();
  // 保持右下角不动
  win.setBounds({
    x: Math.round(b.x + b.width - w),
    y: Math.round(b.y + b.height - h),
    width: w,
    height: h,
  });
  win.webContents.send('pet:scale', scale);
  chatHost?.onPetMoved();
}

function openSlider() {
  if (!win) return;
  if (slider && !slider.isDestroyed()) {
    slider.show();
    slider.focus();
    return;
  }
  const b = win.getBounds();
  const w = 320;
  const h = 92;
  const x = Math.round(b.x + (b.width - w) / 2);
  const y = Math.max(8, b.y - h - 10);
  slider = new BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  slider.setAlwaysOnTop(true, 'screen-saver');
  slider.loadFile(path.join(__dirname, 'slider.html'), {
    query: { scale: String(currentScale), min: String(MIN_SCALE), max: String(MAX_SCALE) },
  });
  slider.once('ready-to-show', () => slider?.show());
  slider.on('closed', () => {
    slider = null;
  });
}

/* --------------------------------- 拖拽吸附 -------------------------------- */

// 拖拽期间钉住的窗口尺寸。125%/150% DPI 下 win.setPosition() 会让窗口每帧长大 1px
// （系统按缩放四舍五入），必须用 setBounds 显式带尺寸，否则"越拖越大、越拖越远"。
let dragPin: { w: number; h: number } | null = null;

function stopDrag() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragPin = null;
}

function startDrag() {
  if (!win) return;
  stopDrag(); // 会清空 dragPin，所以尺寸必须在它之后记录
  // 拖动开始时打断正在进行的贴边动画：否则两个定时器同时 setPosition，
  // 表现就是"按住拖动时她会自己动"（2026-10-27 用户录屏反馈）。
  if (snapTimer) { clearInterval(snapTimer); snapTimer = null; }
  const bounds = win.getBounds();
  dragPin = { w: bounds.width, h: bounds.height };
  const cursor = screen.getCursorScreenPoint();
  dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  dragTimer = setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    let x = Math.round(p.x - dragOffset.x);
    let y = Math.round(p.y - dragOffset.y);
    // 钳制：至少留 60px 在屏幕里，避免拖到屏幕外找不回来（多显示器按最近的那块算）。
    try {
      const wa = screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea;
      const keep = 60;
      x = Math.min(Math.max(x, wa.x - (win.getBounds().width - keep)), wa.x + wa.width - keep);
      y = Math.min(Math.max(y, wa.y), wa.y + wa.height - keep);
    } catch {}
    const w = dragPin?.w ?? win.getBounds().width;
    const h = dragPin?.h ?? win.getBounds().height;
    // 一定要带 width/height：只 setPosition 在缩放屏上会被系统改尺寸。
    win.setBounds({ x, y, width: w, height: h });
    const nb = win.getBounds();
    if (nb.width !== w || nb.height !== h) {
      try { win.setSize(w, h); } catch {}
    }
    // 气泡跟着她走：节流到 ~60ms，避免每次移动都重排。
    if (Date.now() - lastBubbleMove > 60) {
      lastBubbleMove = Date.now();
      chatHost?.onPetMoved();
    }
  }, 16); // 60fps：8ms 高频 setBounds 在透明窗口上会闪
}

function animateTo(targetX: number, targetY: number) {
  if (!win) return;
  if (snapTimer) clearInterval(snapTimer);
  const [sx, sy] = win.getPosition();
  const start = Date.now();
  const dur = 160;
  snapTimer = setInterval(() => {
    if (!win) return;
    const t = Math.min(1, (Date.now() - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    win.setPosition(Math.round(sx + (targetX - sx) * e), Math.round(sy + (targetY - sy) * e));
    if (t >= 1 && snapTimer) {
      clearInterval(snapTimer);
      snapTimer = null;
    }
  }, 8);
}

function snapToEdge() {
  if (!win) return;
  const wa = workArea();
  const { w, h } = computeWinSize(currentScale);
  const [x, y] = win.getPosition();
  let nx = x;
  let ny = y;
  if (Math.abs(x - wa.x) < SNAP_DIST) nx = wa.x;
  if (Math.abs(wa.x + wa.width - (x + w)) < SNAP_DIST) nx = wa.x + wa.width - w;
  if (Math.abs(y - wa.y) < SNAP_DIST) ny = wa.y;
  if (Math.abs(wa.y + wa.height - (y + h)) < SNAP_DIST) ny = wa.y + wa.height - h;
  if (nx !== x || ny !== y) animateTo(nx, ny);
}

/* ---------------------------------- 托盘 ---------------------------------- */

function send(cmd: string) {
  win?.webContents.send('pet:command', cmd);
}

/**
 * 进入「持续说话」状态：期间嘴一直按音节开合，直到时长走完。
 * 文本消息按字数估时长，语音按音频时长（chat-host 算好传进来）；
 * 多条消息重叠时把结束时间延到最晚的一条。
 */
function speakFor(durationMs: number) {
  if (!win || win.isDestroyed()) return;
  const ms = Math.max(900, Math.min(60000, Math.round(durationMs || 0)));
  talkUntil = Math.max(talkUntil, Date.now() + ms);
  if (!talking) {
    talking = true;
    send('talk-start');
  }
  if (talkTimer) clearTimeout(talkTimer);
  talkTimer = setTimeout(() => {
    talkTimer = null;
    stopTalking();
  }, Math.max(0, talkUntil - Date.now()));
}

function stopTalking() {
  if (talkTimer) {
    clearTimeout(talkTimer);
    talkTimer = null;
  }
  talkUntil = 0;
  if (!talking) return;
  talking = false;
  send('talk-stop');
}

function hidePet() {
  chatHost?.hideBubble();
  win?.hide();
}

function showPet() {
  win?.showInactive();
}

function buildSkinSubmenu(): MenuItemConstructorOptions {
  const current = getSkin().id;
  return {
    label: '穿什么呢',
    submenu: listSkins().map((s) => ({
      label: s.name,
      type: 'radio' as const,
      checked: s.id === current,
      click: () => switchSkin(s.id),
    })),
  };
}

const MENU_ACTIONS: Record<string, { label: string; run: () => void }> = {
  wag: { label: '摇摇尾巴', run: () => send('wag') },
  tailpet: { label: '摸摸尾巴', run: () => send('tailpet') },
  pat: { label: '摸摸头', run: () => send('pat') },
  poke: { label: '戳一下', run: () => send('poke') },
  hop: { label: '跳一下', run: () => send('hop') },
  blink: { label: '眨个眼', run: () => send('blink') },
  talk: { label: '说句话', run: () => send('talk') },
  mouth: { label: '张个嘴', run: () => send('mouth') },
  resize: { label: '调整大小…', run: () => openSlider() },
  recenter: { label: '回到右下角', run: () => placeDefault() },
  hide: { label: '隐藏', run: () => hidePet() },
  quit: { label: '退出', run: () => app.quit() },
};

/** 右键/托盘都放同一组对话入口：文本对话 / 语音对话（和皮肤无关，所有皮肤都能用） */
function chatMenuItems(): MenuItemConstructorOptions[] {
  return [
    { label: '文本对话', click: () => chatHost?.openDialog('text') },
    { label: '语音对话', click: () => chatHost?.openDialog('voice') },
    { type: 'separator' },
  ];
}

/** 专注模式：只停「主动打扰」，用户主动打开对话仍然正常。 */
function focusMenuItem(): MenuItemConstructorOptions {
  return {
    label: '专注模式（不主动打扰）',
    type: 'checkbox',
    checked: chatHost ? chatHost.focusEnabled : settings.focusMode === true,
    click: (item) => { void toggleFocus(Boolean(item.checked)); },
  };
}

async function toggleFocus(enabled: boolean): Promise<void> {
  if (!chatHost) return;
  const ok = await chatHost.setFocusMode(enabled, 'menu');
  if (!ok) {
    console.warn('[focus] 设置失败：SurfCore 没连上？');
    return;
  }
  settings.focusMode = chatHost.focusEnabled;
  persistSettings();
  refreshTrayMenu();
}

/** 右键菜单项来自 skin.interaction.menu，新增皮肤不用改这里 */
function showContextMenu(): Menu | null {
  if (!win) return null;
  const ids = getSkin().manifest.interaction?.menu ?? [
    'resize',
    'separator',
    'recenter',
    'hide',
    'quit',
  ];
  const template: MenuItemConstructorOptions[] = [
    ...chatMenuItems(),
    focusMenuItem(),
    { type: 'separator' },
    buildSkinSubmenu(),
    { type: 'separator' },
  ];
  for (const id of ids) {
    if (id === 'separator') {
      template.push({ type: 'separator' });
      continue;
    }
    const action = MENU_ACTIONS[id];
    if (!action) continue;
    template.push({ label: action.label, click: action.run });
  }
  menuOpenCount += 1;
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
  return menu;
}

function trayTemplate(): MenuItemConstructorOptions[] {
  return [
    ...chatMenuItems(),
    focusMenuItem(),
    { type: 'separator' },
    buildSkinSubmenu(),
    { type: 'separator' },
    { label: '调整大小…', click: () => openSlider() },
    { label: '显示 / 隐藏', click: () => (win?.isVisible() ? hidePet() : showPet()) },
    { label: '回到右下角', click: placeDefault },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ];
}

/** 专注模式开/关后刷新托盘菜单的勾选状态（右键菜单每次现建，不用管）。 */
function refreshTrayMenu(): void {
  if (!tray) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  } catch (err) {
    console.warn('[tray] refresh failed:', err);
  }
}

function createTray() {
  const iconPath = path.join(appRoot(), 'assets', 'tray.png');
  if (!fs.existsSync(iconPath)) {
    console.warn('[tray] icon missing');
    return;
  }
  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('小肥鱼');
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
    tray.on('click', () => (win?.isVisible() ? hidePet() : showPet()));
    console.log('[tray] created');
  } catch (err) {
    console.warn('[tray] failed:', err);
  }
}

/* --------------------------------- 自测 ---------------------------------- */

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function snapshot(dir: string, name: string) {
  if (!win) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  console.log('[selftest]', name);
}

async function runSelftest() {
  if (!win) return;
  const dir = path.join(appRoot(), 'out', 'selftest');
  fs.mkdirSync(dir, { recursive: true });

  // 125% DPI 下系统可能在拖拽中改窗口尺寸 → 立刻压回钉住值。
  win.on('resize', () => {
    if (!dragPin || !win || win.isDestroyed()) return;
    const b = win.getBounds();
    if (b.width === dragPin.w && b.height === dragPin.h) return;
    try { win.setBounds({ x: b.x, y: b.y, width: dragPin.w, height: dragPin.h }); } catch {}
  });

  win.setPosition(320, 240);
  await wait(1400);
  await snapshot(dir, '01-idle');

  await win.webContents.executeJavaScript('window.__rig && window.__rig.setPointer(60, 40)');
  await wait(650);
  await snapshot(dir, '02-gaze-up-left');

  await win.webContents.executeJavaScript('window.__rig && window.__rig.setPointer(430, 470)');
  await wait(650);
  await snapshot(dir, '03-gaze-down-right');

  send('blink');
  await wait(110);
  await snapshot(dir, '04-blink');
  await wait(500);

  await win.webContents.executeJavaScript('window.__rig && window.__rig.setDragging(true)');
  await wait(450);
  await snapshot(dir, '05-drag');
  await win.webContents.executeJavaScript('window.__rig && window.__rig.setDragging(false)');
  await wait(300);

  send('talk');
  await wait(300);
  await snapshot(dir, '06-talk');
  await wait(900);

  // 持续说话：主进程点亮后嘴一直开合（不是只演一遍 2.6 秒），stop 后才收
  await wait(1500); // 先让上面那次一次性 talk 的包络走完
  send('talk-start');
  let maxOpen = 0;
  for (let i = 0; i < 6; i++) {
    await wait(120);
    maxOpen = Math.max(maxOpen, Number(await win.webContents.executeJavaScript('window.__rig.mouthOpen')) || 0);
  }
  const holdOn = await win.webContents.executeJavaScript('window.__rig.talking');
  send('talk-stop');
  await wait(450);
  const holdOff = await win.webContents.executeJavaScript('window.__rig.talking');
  const holdClosed = Number(await win.webContents.executeJavaScript('window.__rig.mouthOpen')) || 0;
  console.log(
    '[selftest] talk-hold:',
    holdOn === true && maxOpen > 0.2,
    '->stop:',
    holdOff === false && holdClosed < 0.2,
    JSON.stringify({ maxOpen, holdClosed })
  );

  send('hop');
  await wait(170);
  await snapshot(dir, '07-hop');

  // 命中：主进程遮罩判定（与窗口是否被别的应用挡着无关）
  const b = win.getBounds();
  const s = currentScale;
  const root = rootOffset(s);
  const headLocal = { x: root.x + 596 * s, y: root.y + 320 * s };
  const outLocal = { x: 4, y: 4 };
  console.log(
    '[selftest] mask-hit:',
    hitAtWindow(headLocal.x, headLocal.y) === true && hitAtWindow(outLocal.x, outLocal.y) === false
  );

  // 输入模式切换（穿透 <-> 可点）
  pollPaused = true;
  setInteractive(true);
  await wait(120);
  const on = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  setInteractive(false);
  await wait(120);
  const off = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  console.log('[selftest] click-through:', on.ignore === false && off.ignore === true, JSON.stringify({ on, off }));

  // 光标停在头上 → 闭眼
  await win.webContents.executeJavaScript('window.__rig.setHeadHover(true)');
  await wait(500);
  await snapshot(dir, '08-hover-head-eyes-closed');
  const hoverEye = await win.webContents.executeJavaScript('window.__rig.hoverEye');
  await win.webContents.executeJavaScript('window.__rig.setHeadHover(false)');
  console.log('[selftest] head-hover-eyes:', hoverEye, '(>=0.9 = closed)');

  // 缩放：改大一点，窗口与渲染应同步
  applyScale(0.55, false);
  await wait(500);
  await snapshot(dir, '09-scale-055');
  const applied = await win.webContents.executeJavaScript(
    '({ scale: window.__rig.scale, rootScale: window.__rig.root.scale.x, rootX: window.__rig.root.x, rootY: window.__rig.root.y })'
  );
  console.log('[selftest] scale:', currentScale, 'size:', JSON.stringify(computeWinSize(currentScale)), 'renderer:', JSON.stringify(applied));

  // 调整大小：滑条窗口能打开、能改尺寸
  openSlider();
  await wait(700);
  const sliderState = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  console.log('[selftest] slider:', sliderState.sliderOpen === true);
  if (slider && !slider.isDestroyed()) {
    const shot = await slider.webContents.capturePage();
    fs.writeFileSync(path.join(dir, '10-slider.png'), shot.toPNG());
    console.log('[selftest] 10-slider');
  }
  applyScale(0.48, false);
  await wait(300);
  slider?.close();
  await wait(200);

  // 缩放梯度：90%（整只刚好）、150%、200%（上限）
  applyScale(0.9, false);
  await wait(500);
  await snapshot(dir, '12-scale-090');
  applyScale(1.5, false);
  await wait(500);
  await snapshot(dir, '13-scale-150');

  // 200% 上限：窗口封顶到工作区，角色按比例放大（上半身会出屏）
  applyScale(MAX_SCALE, false);
  await wait(700);
  const big = await win.webContents.executeJavaScript(
    '({ scale: window.__rig.root.scale.x, winW: window.innerWidth, winH: window.innerHeight })'
  );
  console.log('[selftest] scale-max:', JSON.stringify(big));
  await snapshot(dir, '11-scale-200');
  applyScale(0.44, false);
  await wait(400);

  // 换装：切到第二套 → 重载 → 再切回来
  const before = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  console.log('[selftest] skins:', JSON.stringify({ id: before.skinId, names: before.skinNames }));
  const loaded = new Promise<void>((r) => win!.webContents.once('did-finish-load', () => r()));
  switchSkin('feiyu-02');
  await loaded;
  await wait(900);
  const after = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  console.log('[selftest] skin-switch:', after.skinId === 'feiyu-02', '->', after.skinId);
  await snapshot(dir, '12-skin-switched');

  // 第二套的动作：尾巴 / 点头 / 鞠躬 / 说话 / 摸头
  send('wag');
  await wait(160);
  const tailRot = await win.webContents.executeJavaScript('window.__rig.tailWrap ? window.__rig.tailWrap.rotation : null');
  await snapshot(dir, '13-skin2-wag');
  console.log('[selftest] tail-wag rotation:', tailRot);
  await wait(700);

  send('blink');
  await wait(110);
  await snapshot(dir, '14-skin2-blink');
  await wait(600);

  send('tailpet');
  await wait(260);
  await snapshot(dir, '16-skin2-tailpet');
  await wait(600);

  send('talk');
  await wait(260);
  await snapshot(dir, '17-skin2-talk');
  await wait(700);

  send('pat');
  await wait(280);
  await snapshot(dir, '18-skin2-pat');
  await wait(600);

  // 硬气皮肤：点头上的钢盆要响「邦」，顺带验区域识别与音效加载
  const loaded5 = new Promise<void>((r) => win!.webContents.once('did-finish-load', () => r()));
  switchSkin('feiyu-05');
  await loaded5;
  await wait(900);
  const s5 = currentScale;
  const r5 = rootOffset(s5);
  const potX = r5.x + 650 * s5;
  const potY = r5.y + 425 * s5;
  const sfx = await win.webContents.executeJavaScript(`(() => {
    // 用渲染进程自己的 root 变换算屏幕坐标，避免主进程/渲染进程缩放不同步
    const r = window.__rig;
    const s = r.root.scale.x;
    const x = r.root.x + 650 * s;
    const y = r.root.y + 425 * s;
    const hit = r.hitTest(x, y);
    const region = r.regionAt(x, y);
    window.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true }));
    const el = r.soundPool.get('potHit') && r.soundPool.get('potHit').els[0];
    return {
      point: [Math.round(x), Math.round(y)],
      scale: Number(s.toFixed(3)),
      hit,
      region: region && region.id,
      lastSound: r.lastSound,
      playing: el ? !el.paused : null,
      time: el ? Number(el.currentTime.toFixed(3)) : null,
      ready: r.soundReady('potHit'),
    };
  })()`);
  console.log('[selftest] pot-sfx:', JSON.stringify(sfx));
  await wait(200);
  await snapshot(dir, '19-pot-sfx');

  const back = new Promise<void>((r) => win!.webContents.once('did-finish-load', () => r()));
  switchSkin('feiyu-01');
  await back;
  await wait(900);
  console.log('[selftest] skin-back:', (await win.webContents.executeJavaScript('window.pet.getDebugState()')).skinId);

  // 对话/气泡：不经过模型，验证窗口能起来、能排版、能截图
  if (chatHost) {
    await chatHost.demo();
    await wait(800);
    const demoTalking = await win.webContents.executeJavaScript('window.__rig.talking');
    console.log('[selftest] talk-from-bubble:', demoTalking === true);
    const wins = chatHost.debugWindows();
    const bubbleShot = wins.bubble && !wins.bubble.isDestroyed() ? await wins.bubble.webContents.capturePage() : null;
    if (bubbleShot) {
      fs.writeFileSync(path.join(dir, '20-bubble.png'), bubbleShot.toPNG());
      console.log('[selftest] 20-bubble');
    }
    const dialogShot = wins.dialog && !wins.dialog.isDestroyed() ? await wins.dialog.webContents.capturePage() : null;
    if (dialogShot) {
      fs.writeFileSync(path.join(dir, '21-dialog.png'), dialogShot.toPNG());
      console.log('[selftest] 21-dialog');
    }
    const chatState = chatHost.status();
    console.log('[selftest] chat:', JSON.stringify(chatState));
    chatHost.hideBubble();
    chatHost.closeDialog();
    await wait(300);
  }

  // 右键菜单：构建 + 弹出 + 关闭
  const menu = showContextMenu();
  await wait(450);
  menu?.closePopup(win);
  await wait(200);
  const dbg = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  console.log('[selftest] context-menu: opened =', dbg.menuOpened);

  // 拖拽状态 + 吸附
  await win.webContents.executeJavaScript('window.pet.dragStart()');
  await wait(150);
  const dragOn = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  await win.webContents.executeJavaScript('window.pet.dragEnd()');
  await wait(250);
  const dragOff = await win.webContents.executeJavaScript('window.pet.getDebugState()');
  console.log('[selftest] drag-state:', dragOn.dragging === true && dragOff.dragging === false);

  // 拖拽钉尺寸：模拟"系统在拖动中把窗口改大"，看是否能自愈回钉住的值。
  if (win) {
    const before = win.getBounds();
    startDrag();
    try { win.setSize(before.width + 40, before.height + 40); } catch {}
    await wait(120);
    const after = win.getBounds();
    stopDrag();
    const sizePinned = after.width === before.width && after.height === before.height;
    console.log('[selftest] drag-size-pin:', sizePinned, JSON.stringify({ before: `${before.width}x${before.height}`, after: `${after.width}x${after.height}` }));
    try { win.setBounds(before); } catch {}
  }

  const wa = workArea();
  const { w, h } = computeWinSize(currentScale);
  win.setBounds({ x: wa.x + wa.width - w - 6, y: wa.y + wa.height - h - 6, width: w, height: h });
  snapToEdge();
  await wait(400);
  const [sx, sy] = win.getPosition();
  console.log(
    '[selftest] snap-to-edge:',
    sx === wa.x + wa.width - w && sy === wa.y + wa.height - h,
    JSON.stringify({ sx, sy })
  );

  console.log('[selftest] done');
  await wait(200);
  app.quit();
}

/* --------------------------------- 启动 ---------------------------------- */

// 供外部（比如 SurfCore 桌宠栏目）判断「我是不是还在跑」：没权限读进程时就读这个文件
const pidFile = process.env.FEIYU_PET_PIDFILE || path.join(appRoot(), 'run.pid');
if (pidFile) {
  try { fs.writeFileSync(pidFile, String(process.pid)); } catch {}
}

app.whenReady().then(() => {
  if (!hasSingleInstance) return;

  settings = loadSettings();
  if (skinArg) {
    settings.skin = skinArg.slice('--skin='.length);
    console.log('[boot] skin override ->', settings.skin);
  }
  currentScale = settings.scale;
  console.log('[boot] scale =', currentScale);

  ipcMain.handle('skin:get', () => getSkin());
  ipcMain.handle('services:describe', () => describeServices());
  ipcMain.handle('pet:debug-state', () => ({
    ignore: debugIgnore,
    dragging: dragTimer !== null,
    pos: win?.getPosition() ?? null,
    menuOpened: menuOpenCount,
    sliderOpen: !!slider && !slider.isDestroyed(),
    skinId: getSkin().id,
    skinNames: listSkins().map((s) => s.name),
    chat: chatHost?.status() ?? null,
  }));

  ipcMain.on('pet:drag-start', () => startDrag());
  ipcMain.on('pet:drag-end', () => {
    stopDrag();
    snapToEdge();
  });
  ipcMain.on('pet:quit', () => app.quit());
  ipcMain.on('pet:log', (_e, msg: string) => console.log('[renderer]', msg));
  ipcMain.on('pet:menu', () => showContextMenu());
  ipcMain.on('pet:input-mode-ack', () => {});
  ipcMain.on('pet:mask', (_e, payload: { w: number; h: number; bits: Uint8Array }) => {
    const { w, h } = payload;
    const bits = payload.bits instanceof Uint8Array ? payload.bits : Uint8Array.from(payload.bits as unknown as number[]);
    if (w > 0 && h > 0 && bits.length === w * h) {
      maskData = { w, h, bits };
      console.log('[mask] from renderer', w, 'x', h);
    }
  });

  ipcMain.on('scale:preview', (_e, v: number) => applyScale(v, false));
  ipcMain.on('scale:commit', (_e, v: number) => applyScale(v, true));
  ipcMain.on('slider:close', () => slider?.close());

  console.log('[skin] available:', listSkins().map((s) => `${s.id}=${s.name}`).join(' | '));
  createWindow();
  // 对话宿主要在托盘/右键菜单之前建好：菜单项点击时 chatHost 必须已经存在。
  chatHost = new ChatHost({
    distDir: __dirname,
    preload: path.join(__dirname, 'preload.js'),
    getPetWindow: () => win,
    onSpeak: (ms) => speakFor(ms),
    onModeChange: (mode) => {
      settings.dialogMode = mode;
      persistSettings();
    },
    onFocusChange: (enabled) => {
      settings.focusMode = enabled;
      persistSettings();
      refreshTrayMenu();
    },
    log: (...args: unknown[]) => console.log('[chat]', ...args),
  });
  chatHost.setInitialMode(settings.dialogMode === 'voice' ? 'voice' : 'text');
  chatHost.setInitialFocus(settings.focusMode === true);
  chatHost.registerIpc(ipcMain);
  chatHost.start();
  createTray();

  if (isSelftest) {
    win?.webContents.once('did-finish-load', () => {
      runSelftest().catch((err) => {
        console.error('[selftest] failed', err);
        app.quit();
      });
    });
    return;
  }

  if (capturePath) {
    win?.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (!win) return;
        try {
          if (actionArg) {
            const action = actionArg.slice('--action='.length);
            // 对话入口也能用命令行触发（自动化截图/排障用）：--action=chat-text / chat-voice
            if (action === 'chat-text' || action === 'chat-voice') {
              chatHost?.openDialog(action === 'chat-voice' ? 'voice' : 'text');
              await wait(900);
            } else if (action === 'mouth-open' || action === 'mouth-closed') {
              // 固定嘴部开合度，方便对比截图（调试用）
              const v = action === 'mouth-open' ? 1 : 0;
              await win.webContents.executeJavaScript(`window.__rig && window.__rig.setMouthOverride(${v})`);
              await wait(650);
            } else if (action === 'mouth') {
              send(action);
              await wait(600);
            } else {
              send(action);
              await wait(140);
            }
          }
          const img = await win.webContents.capturePage();
          const abs = path.isAbsolute(capturePath) ? capturePath : path.join(appRoot(), capturePath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, img.toPNG());
          console.log('[capture]', abs);
        } catch (err) {
          console.error('[capture] failed', err);
        } finally {
          app.quit();
        }
      }, 1500);
    });
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (pidFile) { try { fs.rmSync(pidFile, { force: true }); } catch {} }
  stopDrag();
  if (inputPoll) clearInterval(inputPoll);
  if (snapTimer) clearInterval(snapTimer);
  if (talkTimer) clearTimeout(talkTimer);
  talkTimer = null;
  try { chatHost?.dispose(); } catch {}
  chatHost = null;
});
