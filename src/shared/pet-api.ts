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
}

declare global {
  interface Window {
    pet: PetApi;
  }
}
