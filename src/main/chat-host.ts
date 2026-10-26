/**
 * 桌宠的对话宿主（主进程）。
 *
 * 两个窗口：
 *   · 对话窗（dialog.html）：右键「文本对话 / 语音对话」打开；输入 → SurfCore 出一句 →
 *     文本模式回文字，语音模式回语音（气泡里始终有文字）。
 *   · 气泡（bubble.html）：所有「小肥鱼说的话」都在这里显示文字；
 *     语音回复/主动搭话会同时播音频。每条气泡都有「回复」按钮：
 *     点它跳到对话框，并且按那条话的形式（文本/语音）打开。
 *
 * 主动搭话由 SurfCore 的「目的」插件推送（长轮询 /events），这里只负责展示。
 */
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type {
  BubblePayload, ChatHistoryPayload, ChatMessage, ChatStatePayload, PetPublicConfig, SurfCoreEvent,
} from '../shared/chat';
import { SurfCoreClient } from './surfcore';

export type { BubblePayload } from '../shared/chat';

export interface ChatHostDeps {
  distDir: string;
  preload: string;
  getPetWindow: () => BrowserWindow | null;
  onSpeak: (durationMs: number) => void;
  onModeChange: (mode: 'text' | 'voice') => void;
  onFocusChange?: (enabled: boolean) => void;
  log: (...args: unknown[]) => void;
}

const DIALOG_W = 392;
const DIALOG_H = 576;
const BUBBLE_W = 360;
const BUBBLE_MIN_H = 120;

function nowMs() {
  return Date.now();
}

export class ChatHost {
  private client = new SurfCoreClient();
  private deps: ChatHostDeps;
  private dialog: BrowserWindow | null = null;
  private bubble: BrowserWindow | null = null;
  private dialogMode: 'text' | 'voice' = 'text';
  private messages: ChatMessage[] = [];
  private pending = false;
  private config: PetPublicConfig | null = null;
  private connected = false;
  private connectError = '';
  private focusMode = false;
  private bubblePayload: BubblePayload | null = null;
  private bubbleVisible = false;
  private bubbleHovering = false;
  private bubbleTimer: NodeJS.Timeout | null = null;
  private bubbleHardTimer: NodeJS.Timeout | null = null;
  private bubbleSize = { w: BUBBLE_W, h: BUBBLE_MIN_H };
  private ipcReady = false;
  private disposed = false;

  constructor(deps: ChatHostDeps) {
    this.deps = deps;
    this.client.on('event', (event: SurfCoreEvent) => this.onEvent(event));
    this.client.on('proactive', (event: SurfCoreEvent) => this.onProactive(event));
    this.client.on('connection', (state: { connected: boolean; error: string }) => {
      this.connected = Boolean(state.connected);
      this.connectError = state.connected ? '' : (state.error || '连不上 SurfCore');
      if (this.connected) {
        void this.refreshConfig();
      }
      this.broadcastDialog('chat:state', this.statePayload());
      this.deps.log(`[chat] surfcore ${this.connected ? 'connected' : `offline: ${this.connectError}`}`);
    });
    this.client.on('config', (config: PetPublicConfig) => {
      this.config = config;
      this.applyFocus(Boolean(config.focus?.enabled), 'config');
      this.broadcastDialog('chat:state', this.statePayload());
    });
  }

  start(): void {
    this.client.start();
    // 先同步拉一次配置：对话框标题/角色名不用等轮询回来。
    void this.refreshConfig();
  }

  get currentMode(): 'text' | 'voice' {
    return this.dialogMode;
  }

  setInitialMode(mode: 'text' | 'voice'): void {
    if (mode === 'text' || mode === 'voice') this.dialogMode = mode;
  }

  /** 启动时的本地缓存值；连上后以插件 focus.json 为准。 */
  setInitialFocus(enabled: boolean): void {
    this.focusMode = enabled === true;
  }

  get focusEnabled(): boolean {
    return this.focusMode;
  }

  private applyFocus(enabled: boolean, reason = 'remote'): void {
    const next = enabled === true;
    if (this.focusMode === next) return;
    this.focusMode = next;
    this.deps.log(`[chat] focus mode ${next ? 'on' : 'off'} (${reason})`);
    if (next) this.hideBubble();
    this.deps.onFocusChange?.(next);
    this.broadcastDialog('chat:state', this.statePayload());
  }

  /** 右键菜单/设置页切换。写插件 focus.json，成功后立刻本地生效。 */
  async setFocusMode(enabled: boolean, source = 'menu'): Promise<boolean> {
    try {
      const result = await this.client.setFocus(enabled);
      if (result?.ok === false) throw new Error(result.error || '设置专注模式失败');
      this.applyFocus(result?.focus?.enabled ?? enabled, source);
      return true;
    } catch (error) {
      this.deps.log('[chat] set focus failed:', String((error as Error)?.message ?? error));
      return false;
    }
  }

  get clientRef(): SurfCoreClient {
    return this.client;
  }

  private async refreshConfig(): Promise<void> {
    try {
      const config = await this.client.fetchConfig();
      this.config = config;
      this.connected = true;
      this.broadcastDialog('chat:state', this.statePayload());
    } catch (error) {
      // 没连上不覆盖已有配置；轮询回来会补。
      if (!this.config) this.connectError = String((error as Error)?.message ?? error);
    }
  }

  private statePayload(): ChatStatePayload {
    return {
      connected: this.connected || this.client.isConnected,
      error: this.connected || this.client.isConnected ? '' : (this.connectError || this.client.lastConnectError),
      config: this.config,
      focus: this.focusMode,
    };
  }

  /* --------------------------------- 窗口 --------------------------------- */

  private petBounds() {
    const pet = this.deps.getPetWindow();
    if (pet && !pet.isDestroyed()) return pet.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    return { x: wa.x + wa.width - 300, y: wa.y + wa.height - 400, width: 300, height: 400 };
  }

  /** 对话框开着且可见时，语音由对话框播放；气泡只显示文字，避免两个 <audio> 同时响（回音）。 */
  private dialogAudioActive(): boolean {
    const win = this.dialog;
    if (!win || win.isDestroyed() || !win.isVisible()) return false;
    return true;
  }

  private pauseBubbleAudio(): void {
    const win = this.bubble;
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('bubble:pause-audio', {}); } catch {}
  }

  private positionDialog(win: BrowserWindow): void {
    const pet = this.petBounds();
    const wa = screen.getDisplayMatching({ x: pet.x, y: pet.y, width: pet.width, height: pet.height }).workArea;
    const size = win.getBounds();
    let x = pet.x - size.width - 12;
    let y = pet.y + pet.height - size.height;
    if (x < wa.x + 8) {
      x = pet.x + pet.width + 12;
      if (x + size.width > wa.x + wa.width - 8) x = Math.round(wa.x + (wa.width - size.width) / 2);
    }
    y = Math.min(Math.max(y, wa.y + 8), wa.y + wa.height - size.height - 8);
    win.setPosition(Math.round(x), Math.round(y));
  }

  openDialog(mode?: 'text' | 'voice'): void {
    if (mode === 'text' || mode === 'voice') this.setMode(mode, true);
    // 对话框要开始播语音了：先让气泡停下，避免两个窗口叠着响。
    this.pauseBubbleAudio();
    if (this.dialog && !this.dialog.isDestroyed()) {
      if (!this.dialog.isVisible()) this.dialog.show();
      this.dialog.focus();
      this.dialog.webContents.send('chat:mode', { mode: this.dialogMode });
      this.dialog.webContents.send('chat:focus-input', {});
      return;
    }
    const win = new BrowserWindow({
      width: DIALOG_W,
      height: DIALOG_H,
      minWidth: 330,
      minHeight: 430,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      show: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: '小肥鱼',
      webPreferences: {
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.dialog = win;
    win.setAlwaysOnTop(true, 'floating');
    win.loadFile(path.join(this.deps.distDir, 'dialog.html'), { query: { mode: this.dialogMode } });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        this.positionDialog(win);
        win.show();
        win.focus();
      }
    });
    win.on('closed', () => {
      if (this.dialog === win) this.dialog = null;
    });
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('chat:state', this.statePayload());
      win.webContents.send('chat:mode', { mode: this.dialogMode });
    });
  }

  closeDialog(): void {
    if (this.dialog && !this.dialog.isDestroyed()) this.dialog.close();
    this.dialog = null;
  }

  private ensureBubble(): BrowserWindow {
    if (this.bubble && !this.bubble.isDestroyed()) return this.bubble;
    const win = new BrowserWindow({
      width: this.bubbleSize.w,
      height: this.bubbleSize.h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: '小肥鱼',
      webPreferences: {
        preload: this.deps.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    this.bubble = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(this.deps.distDir, 'bubble.html'));
    win.on('closed', () => {
      if (this.bubble === win) this.bubble = null;
      this.bubbleVisible = false;
    });
    return win;
  }

  private positionBubble(): void {
    const win = this.bubble;
    if (!win || win.isDestroyed()) return;
    const pet = this.petBounds();
    const wa = screen.getDisplayMatching({ x: pet.x, y: pet.y, width: pet.width, height: pet.height }).workArea;
    const w = this.bubbleSize.w;
    const h = this.bubbleSize.h;
    let x = Math.round(pet.x + pet.width / 2 - w / 2);
    let y = Math.round(pet.y - h - 8);
    if (y < wa.y + 4) {
      y = Math.round(pet.y + Math.min(120, Math.max(24, pet.height * 0.18)));
    }
    x = Math.min(Math.max(x, wa.x + 4), wa.x + wa.width - w - 4);
    y = Math.min(Math.max(y, wa.y + 4), wa.y + wa.height - h - 4);
    win.setBounds({ x, y, width: w, height: h });
  }

  onPetMoved(): void {
    if (this.bubbleVisible) this.positionBubble();
  }

  /* -------------------------------- 消息 --------------------------------- */

  private withAbsoluteAudio(message: ChatMessage): ChatMessage {
    if (!message?.audio?.url) return message;
    return { ...message, audio: { ...message.audio, url: this.client.absoluteUrl(message.audio.url) } };
  }

  private remember(message: ChatMessage): ChatMessage {
    if (!message?.id) return message;
    const exists = this.messages.some((m) => m.id === message.id);
    if (!exists) this.messages.push(message);
    if (this.messages.length > 240) this.messages = this.messages.slice(-240);
    return message;
  }

  private broadcastDialog(channel: string, payload: unknown): void {
    const win = this.dialog;
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send(channel, payload); } catch {}
  }

  private onEvent(event: SurfCoreEvent): void {
    if (!event) return;
    if (event.type === 'focus') {
      this.applyFocus(event.enabled === true, 'event');
      return;
    }
    // 设置页「发一句试试」推来的回复：和普通回复一样弹气泡/进对话框，但不标「主动」。
    if (event.type === 'reply' && event.text) {
      const message: ChatMessage = this.remember(this.withAbsoluteAudio({
        id: String(event.messageId || `reply-${event.id}`),
        role: 'assistant',
        text: String(event.text),
        modality: event.modality === 'voice' ? 'voice' : 'text',
        at: Number(event.at) || nowMs(),
        audio: event.audio,
      }));
      this.broadcastDialog('chat:message', message);
      this.showBubble(message);
      return;
    }
    // 主动搭话由专门的 'proactive' 监听处理；这里留给以后的其它事件类型。
  }

  private onProactive(event: SurfCoreEvent): void {
    const text = String(event.text || '').trim();
    if (!text) return;
    if (this.focusMode) {
      // 双保险：插件在专注模式下不该主动发；万一手动强制/时序晚到，这里也不弹。
      this.deps.log('[chat] focus mode on: drop proactive');
      return;
    }
    const message: ChatMessage = this.remember(this.withAbsoluteAudio({
      id: String(event.messageId || `proactive-${event.id}`),
      role: 'assistant',
      text,
      modality: event.modality === 'voice' ? 'voice' : 'text',
      at: Number(event.at) || nowMs(),
      proactive: true,
      audio: event.audio,
    }));
    this.broadcastDialog('chat:message', message);
    this.showBubble(message);
  }

  /** 对话框发送（文本/语音）。回复统一走气泡 + 对话框。 */
  async sendChat(text: string, mode: 'text' | 'voice'): Promise<{ ok: boolean; error?: string }> {
    const say = String(text || '').trim();
    if (!say) return { ok: false, error: '说点什么吧' };
    if (this.pending) return { ok: false, error: '她还在回上一句' };
    if (!this.client.isConnected) {
      return { ok: false, error: this.client.lastConnectError || '还没连上 SurfCore（先在设置 → 桌宠 里启动）' };
    }
    this.pending = true;
    this.broadcastDialog('chat:typing', { pending: true });
    try {
      const result = await this.client.chat(say, mode);
      if (!result.ok || !result.reply) throw new Error(result.error || '她这次没说话');
      if (result.userMessage) this.remember(this.withAbsoluteAudio(result.userMessage));
      const reply = this.remember(this.withAbsoluteAudio(result.reply));
      this.broadcastDialog('chat:message', reply);
      this.showBubble(reply);
      return { ok: true };
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      this.broadcastDialog('chat:error', { message });
      this.deps.log('[chat] send failed:', message);
      return { ok: false, error: message };
    } finally {
      this.pending = false;
      this.broadcastDialog('chat:typing', { pending: false });
    }
  }

  async historyPayload(): Promise<ChatHistoryPayload> {
    let messages = this.messages.map((m) => this.withAbsoluteAudio(m));
    let roleName = this.config?.role?.name || '小肥鱼';
    if (this.client.isConnected) {
      try {
        const history = await this.client.history(80);
        if (history?.ok && Array.isArray(history.messages)) {
          messages = history.messages.map((m) => this.withAbsoluteAudio(m));
          this.messages = messages.slice(-240);
          roleName = history.role?.name || roleName;
        }
      } catch (error) {
        this.deps.log('[chat] history failed:', String((error as Error)?.message ?? error));
      }
    }
    const state = this.statePayload();
    return {
      ok: true,
      connected: state.connected,
      error: state.error,
      config: state.config,
      role: { name: roleName },
      messages,
      pending: this.pending,
    };
  }

  /* -------------------------------- 气泡 --------------------------------- */

  private showBubble(message: ChatMessage): void {
    const payload: BubblePayload = {
      messageId: message.id,
      text: message.text,
      modality: message.modality,
      at: message.at,
      proactive: Boolean(message.proactive),
      // 对话框可见时由它播放；气泡仍显示文字 + 播放按钮（用户可手动点）。
      autoplay: !this.dialogAudioActive(),
      audio: message.audio?.url ? { url: message.audio.url, durationMs: Number(message.audio.durationMs) || 0 } : undefined,
    };
    // 说话动画：语音按音频时长，文本按字数估一个（文本没有音频可跟）；
    // 两种形式都要一直动到这句话说完，而不是只动一遍 2.6 秒。
    const speechMs = payload.audio?.durationMs
      ? payload.audio.durationMs + 600
      : Math.min(15000, Math.max(3000, 700 + payload.text.length * 130));
    this.deps.onSpeak(speechMs);
    if (this.bubbleVisible) {
      // 新的一句直接顶掉旧的：最新一句最要紧。
      // （鼠标悬停只暂停「自动隐藏」，不能把后面的消息一直堵在队列里。）
      this.displayBubble(payload);
      return;
    }
    this.displayBubble(payload);
  }

  private displayBubble(payload: BubblePayload): void {
    this.bubblePayload = payload;
    this.bubbleVisible = true;
    this.bubbleHovering = false;
    const win = this.ensureBubble();
    const send = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('bubble:show', payload);
      this.positionBubble();
      try { win.showInactive(); } catch { try { win.show(); } catch {} }
    };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', send);
    } else {
      send();
    }
    this.scheduleBubbleHide(payload);
    // 鼠标一直停在气泡上时也不能永远不消失：最多露 60 秒。
    if (this.bubbleHardTimer) clearTimeout(this.bubbleHardTimer);
    this.bubbleHardTimer = setTimeout(() => this.hideBubble(), 60_000);
  }

  private bubbleDuration(payload: BubblePayload): number {
    const reading = 4500 + Math.min(16000, payload.text.length * 110);
    const audio = payload.audio?.durationMs ? payload.audio.durationMs + 3500 : 0;
    return Math.min(30000, Math.max(6500, reading, audio));
  }

  private scheduleBubbleHide(payload: BubblePayload): void {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.hideBubble(), this.bubbleDuration(payload));
  }

  private clearBubbleTimer(): void {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = null;
  }

  hideBubble(): void {
    this.clearBubbleTimer();
    if (this.bubbleHardTimer) clearTimeout(this.bubbleHardTimer);
    this.bubbleHardTimer = null;
    this.bubbleVisible = false;
    this.bubblePayload = null;
    this.bubbleHovering = false;
    const win = this.bubble;
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('bubble:hide', {}); } catch {}
      try { win.hide(); } catch {}
    }
  }

  setBubbleSize(width: number, height: number): void {
    const w = Math.max(220, Math.min(520, Math.round(width) || BUBBLE_W));
    const h = Math.max(80, Math.min(420, Math.round(height) || BUBBLE_MIN_H));
    this.bubbleSize = { w, h };
    if (this.bubbleVisible) this.positionBubble();
  }

  private bubbleReply(messageId: string): void {
    const message = this.messages.find((m) => m.id === messageId);
    const mode = message?.modality === 'voice' ? 'voice' : 'text';
    this.hideBubble();
    this.openDialog(mode);
  }

  /* --------------------------------- 模式 --------------------------------- */

  private setMode(mode: 'text' | 'voice', persist = false): void {
    const next = mode === 'voice' ? 'voice' : 'text';
    this.dialogMode = next;
    this.broadcastDialog('chat:mode', { mode: next });
    if (persist) this.deps.onModeChange(next);
  }

  /* --------------------------------- IPC --------------------------------- */

  registerIpc(ipcMain: import('electron').IpcMain): void {
    if (this.ipcReady) return;
    this.ipcReady = true;
    ipcMain.on('chat:open', (_e, payload: { mode?: 'text' | 'voice' }) => {
      this.openDialog(payload?.mode);
    });
    ipcMain.on('chat:close', (event) => {
      if (this.dialog && event.sender === this.dialog.webContents) this.closeDialog();
    });
    ipcMain.on('chat:mode', (_e, payload: { mode?: 'text' | 'voice' }) => {
      this.setMode(payload?.mode === 'voice' ? 'voice' : 'text', true);
    });
    ipcMain.handle('chat:send', async (_e, payload: { text?: string; mode?: 'text' | 'voice' }) => {
      return this.sendChat(String(payload?.text || ''), payload?.mode === 'voice' ? 'voice' : 'text');
    });
    ipcMain.handle('chat:history', async () => this.historyPayload());
    ipcMain.on('chat:reconnect', () => this.client.reconnect());
    // 语音只允许一个窗口出声：谁先开始，另一个立刻暂停。
    ipcMain.on('chat:audio-start', () => this.pauseBubbleAudio());
    ipcMain.on('bubble:audio-start', () => {
      const win = this.dialog;
      if (win && !win.isDestroyed()) {
        try { win.webContents.send('chat:pause-audio', {}); } catch {}
      }
    });
    ipcMain.on('bubble:ready', () => {
      // 渲染进程挂载完成：只校正位置（尺寸由 bubble:resize 报上来）。
      if (this.bubbleVisible) this.positionBubble();
    });
    ipcMain.on('bubble:resize', (_e, payload: { width?: number; height?: number }) => {
      this.setBubbleSize(Number(payload?.width), Number(payload?.height));
    });
    ipcMain.on('bubble:action', (_e, payload: { action?: string; messageId?: string }) => {
      if (payload?.action === 'reply' && payload.messageId) this.bubbleReply(payload.messageId);
      else if (payload?.action === 'close') this.hideBubble();
    });
    ipcMain.on('bubble:hover', (_e, payload: { hovering?: boolean }) => {
      const hovering = Boolean(payload?.hovering);
      this.bubbleHovering = hovering;
      if (hovering) {
        this.clearBubbleTimer();
      } else if (this.bubbleVisible && this.bubblePayload) {
        this.scheduleBubbleHide(this.bubblePayload);
      }
    });
  }

  /* -------------------------------- 自测/状态 ----------------------------- */

  /** 自测用：不经过模型，直接验证气泡与对话框的显示/排版。 */
  async demo(): Promise<void> {
    const sample: ChatMessage = {
      id: `demo-${nowMs()}`,
      role: 'assistant',
      text: '咪…主人今天摸摸 wo 的头，wo 就一直在等下一句啦 mer',
      modality: 'text',
      at: nowMs(),
      proactive: true,
    };
    this.remember(sample);
    this.openDialog('text');
    this.showBubble(sample);
    await new Promise((r) => setTimeout(r, 900));
    const user: ChatMessage = { id: `demo-u-${nowMs()}`, role: 'user', text: '在干嘛呀', modality: 'text', at: nowMs() };
    const reply: ChatMessage = {
      id: `demo-r-${nowMs()}`,
      role: 'assistant',
      text: '没干嘛呀，就在桌面上发呆等主人来戳 wo 呢 mer',
      modality: 'voice',
      at: nowMs(),
    };
    this.broadcastDialog('chat:message', user);
    this.broadcastDialog('chat:message', {
      ...reply,
      audio: { key: 'demo', url: '', durationMs: 2200 },
    });    await new Promise((r) => setTimeout(r, 700));
  }

  debugWindows(): { dialog: BrowserWindow | null; bubble: BrowserWindow | null } {
    return { dialog: this.dialog, bubble: this.bubble };
  }

  status(): Record<string, unknown> {
    return {
      connected: this.connected || this.client.isConnected,
      error: this.connected || this.client.isConnected ? '' : (this.connectError || this.client.lastConnectError),
      mode: this.dialogMode,
      focus: this.focusMode,
      messages: this.messages.length,
      bubbleVisible: this.bubbleVisible,
      dialogOpen: Boolean(this.dialog && !this.dialog.isDestroyed()),
      role: this.config?.role?.name ?? '',
      host: this.client.info?.baseUrl ?? '',
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearBubbleTimer();
    if (this.bubbleHardTimer) clearTimeout(this.bubbleHardTimer);
    this.client.stop();
    for (const win of [this.dialog, this.bubble]) {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
    }
    this.dialog = null;
    this.bubble = null;
  }
}
