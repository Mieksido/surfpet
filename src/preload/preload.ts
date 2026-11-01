import { contextBridge, ipcRenderer } from 'electron';
import type {
  BubblePayload, ChatHistoryPayload, ChatMessage, ChatStatePayload,
} from '../shared/chat';
import type { ChatMode } from '../shared/pet-api';

export interface SkinPayload {
  manifest: any;
  baseUrl: string;
  skinCount: number;
  id: string;
  scale: number;
}

function on<T>(channel: string, cb: (payload: T) => void) {
  ipcRenderer.on(channel, (_e, payload: T) => cb(payload));
}

contextBridge.exposeInMainWorld('pet', {
  getSkin: (): Promise<SkinPayload> => ipcRenderer.invoke('skin:get'),
  getServices: (): Promise<unknown> => ipcRenderer.invoke('services:describe'),
  getDebugState: (): Promise<{
    ignore: boolean;
    dragging: boolean;
    pos: [number, number] | null;
    menuOpened: number;
  }> => ipcRenderer.invoke('pet:debug-state'),

  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  openMenu: () => ipcRenderer.send('pet:menu'),
  setMask: (m: { w: number; h: number; bits: Uint8Array }) => ipcRenderer.send('pet:mask', m),
  log: (msg: string) => ipcRenderer.send('pet:log', msg),

  /** persist=false 时只预览（拖动中），true 时落盘 */
  setScale: (v: number, persist = false) => ipcRenderer.send(persist ? 'scale:commit' : 'scale:preview', v),
  closeSlider: () => ipcRenderer.send('slider:close'),

  onCommand: (cb: (cmd: string) => void) => {
    ipcRenderer.on('pet:command', (_e, cmd: string) => cb(cmd));
  },
  onScale: (cb: (scale: number) => void) => {
    ipcRenderer.on('pet:scale', (_e, scale: number) => cb(scale));
  },
  onInputMode: (cb: (interactive: boolean) => void) => {
    ipcRenderer.on('pet:input-mode', (_e, v: boolean) => cb(v));
  },

  /* ------------------------------- 对话框 ------------------------------- */
  chat: {
    open: (mode?: ChatMode) => ipcRenderer.send('chat:open', { mode }),
    close: () => ipcRenderer.send('chat:close'),
    setMode: (mode: ChatMode) => ipcRenderer.send('chat:mode', { mode }),
    send: (text: string, mode: ChatMode): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('chat:send', { text, mode }),
    history: (): Promise<ChatHistoryPayload> => ipcRenderer.invoke('chat:history'),
    reconnect: () => ipcRenderer.send('chat:reconnect'),
    audioStarted: () => ipcRenderer.send('chat:audio-start'),

    onState: (cb: (state: ChatStatePayload) => void) => on('chat:state', cb),
    onMode: (cb: (payload: { mode: ChatMode }) => void) => on('chat:mode', cb),
    onMessage: (cb: (message: ChatMessage) => void) => on('chat:message', cb),
    onTyping: (cb: (payload: { pending: boolean }) => void) => on('chat:typing', cb),
    onError: (cb: (payload: { message: string }) => void) => on('chat:error', cb),
    onFocusInput: (cb: () => void) => on('chat:focus-input', cb),
    onPauseAudio: (cb: () => void) => ipcRenderer.on('chat:pause-audio', () => cb()),
  },

  /* -------------------------------- 气泡 -------------------------------- */
  bubble: {
    ready: () => ipcRenderer.send('bubble:ready'),
    resize: (width: number, height: number) => ipcRenderer.send('bubble:resize', { width, height }),
    action: (action: 'reply' | 'close', messageId?: string) => ipcRenderer.send('bubble:action', { action, messageId }),
    hover: (hovering: boolean) => ipcRenderer.send('bubble:hover', { hovering }),
    audioStarted: () => ipcRenderer.send('bubble:audio-start'),
    onShow: (cb: (payload: BubblePayload) => void) => on('bubble:show', cb),
    onHide: (cb: () => void) => on('bubble:hide', (_p: unknown) => cb()),
    onPauseAudio: (cb: () => void) => ipcRenderer.on('bubble:pause-audio', () => cb()),
  },

  /* ------------------------------ 电话模式 ------------------------------ */
  /*
   * 独立命名空间，不与 dialog 共用通道：dialog 仍然只用 chat:*，
   * 电话模式额外加 phone:*。以后要删掉电话模式，删这一块 + 主进程里的
   * phone:* IPC 即可，不会碰到原有对话窗。
   */
  phone: {
    history: (): Promise<ChatHistoryPayload> => ipcRenderer.invoke('phone:history'),
    send: (text: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('phone:send', { text }),
    transcribe: (
      data: ArrayBuffer,
      format: string,
    ): Promise<{ ok: boolean; text?: string; error?: string; elapsedMs?: number }> =>
      ipcRenderer.invoke('phone:transcribe', { data, format }),
    audioStarted: () => ipcRenderer.send('phone:audio-start'),
    close: () => ipcRenderer.send('phone:close'),
    setCollapsed: (v: boolean) => ipcRenderer.send('phone:collapsed', { collapsed: Boolean(v) }),
    setBallSize: (size: number) => ipcRenderer.send('phone:set-ball-size', { size: Number(size) || 0 }),

    onState: (cb: (state: ChatStatePayload) => void) => on('chat:state', cb),
    onHistory: (cb: (payload: ChatHistoryPayload) => void) => on('phone:history-data', cb),
    onReply: (cb: (message: ChatMessage) => void) => on('chat:message', cb),
    onTyping: (cb: (payload: { pending: boolean }) => void) => on('chat:typing', cb),
    onError: (cb: (payload: { message: string }) => void) => on('chat:error', cb),
    onCollapsed: (cb: (v: boolean) => void) =>
      on<{ collapsed: boolean }>('phone:collapsed-state', (p) => cb(p?.collapsed === true)),
  },
});
