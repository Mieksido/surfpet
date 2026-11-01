/** 预加载脚本暴露给渲染进程的接口。主窗口、滑条、气泡、对话框共用。 */

import type {
  BubblePayload, ChatHistoryPayload, ChatMessage, ChatStatePayload,
} from './chat';

export interface SkinPayload {
  manifest: any;
  baseUrl: string;
  skinCount: number;
  id: string;
  scale: number;
}

export type ChatMode = 'text' | 'voice';

export interface PetChatApi {
  /** 打开对话框（不传就用上次的形式） */
  open(mode?: ChatMode): void;
  close(): void;
  setMode(mode: ChatMode): void;
  send(text: string, mode: ChatMode): Promise<{ ok: boolean; error?: string }>;
  history(): Promise<ChatHistoryPayload>;
  reconnect(): void;
  /** 对话框开始播语音（主进程会让气泡先停下） */
  audioStarted(): void;

  onState(cb: (state: ChatStatePayload) => void): void;
  onMode(cb: (payload: { mode: ChatMode }) => void): void;
  onMessage(cb: (message: ChatMessage) => void): void;
  onTyping(cb: (payload: { pending: boolean }) => void): void;
  onError(cb: (payload: { message: string }) => void): void;
  onFocusInput(cb: () => void): void;
  onPauseAudio(cb: () => void): void;
}

export interface PetBubbleApi {
  ready(): void;
  resize(width: number, height: number): void;
  action(action: 'reply' | 'close', messageId?: string): void;
  hover(hovering: boolean): void;
  /** 气泡开始播语音（主进程会让对话框先停下） */
  audioStarted(): void;
  onShow(cb: (payload: BubblePayload) => void): void;
  onHide(cb: () => void): void;
  onPauseAudio(cb: () => void): void;
}

/** 电话模式：语音进、语音出的连续对话，可收成悬浮球。 */
export interface PetPhoneApi {
  history(): Promise<ChatHistoryPayload>;
  /** 发一句话；电话模式一律用语音回。 */
  send(text: string): Promise<{ ok: boolean; error?: string }>;
  /**
   * 把录音交给本地 ASR 服务转文字。
   *
   * format 传 'ogg' 或 'wav'。⚠️ 不要传 'webm'：服务端为了解 webm 会调外部
   * ffmpeg，而那个进程在 Windows 上每次都会闪一个黑窗。
   */
  transcribe(
    data: ArrayBuffer,
    format: string,
  ): Promise<{ ok: boolean; text?: string; error?: string; elapsedMs?: number }>;
  /** 开始播语音（主进程会让别的窗口先停下） */
  audioStarted(): void;
  close(): void;
  /** 收起成悬浮球 / 展开成面板 */
  setCollapsed(collapsed: boolean): void;
  /** 改变悬浮球直径（px），主进程会记住 */
  setBallSize(size: number): void;

  onState(cb: (state: ChatStatePayload) => void): void;
  onHistory(cb: (payload: ChatHistoryPayload) => void): void;
  onReply(cb: (message: ChatMessage) => void): void;
  onTyping(cb: (payload: { pending: boolean }) => void): void;
  onError(cb: (payload: { message: string }) => void): void;
  onCollapsed(cb: (collapsed: boolean) => void): void;
}

export interface PetApi {
  getSkin(): Promise<SkinPayload>;
  getServices(): Promise<unknown>;
  getDebugState(): Promise<{
    ignore: boolean;
    dragging: boolean;
    pos: [number, number] | null;
    menuOpened: number;
  }>;

  dragStart(): void;
  dragEnd(): void;
  openMenu(): void;
  setMask(m: { w: number; h: number; bits: Uint8Array }): void;
  log(msg: string): void;

  setScale(v: number, persist?: boolean): void;
  closeSlider(): void;

  onCommand(cb: (cmd: string) => void): void;
  onScale(cb: (scale: number) => void): void;
  onInputMode(cb: (interactive: boolean) => void): void;

  chat: PetChatApi;
  bubble: PetBubbleApi;
  phone: PetPhoneApi;
}

declare global {
  interface Window {
    pet: PetApi;
  }
}
