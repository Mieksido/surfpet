/** 桌宠对话窗口 / 气泡窗口 / 主进程共用的类型。 */

export interface ChatAudio {
  key: string;
  /** 带本地令牌的播放地址（插件返回相对路径，主进程补成绝对地址）。 */
  url: string;
  durationMs: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modality: 'text' | 'voice';
  at: number;
  proactive?: boolean;
  audio?: ChatAudio;
}

export interface PetPublicConfig {
  role: { id: string; name: string; hasPersona: boolean };
  chat: { enabled: boolean; remember?: boolean; maxReplyChars: number; voiceMaxChars: number; historyTurns: number };
  proactive: { carrier: 'qq' | 'pet'; modality: 'text' | 'voice'; fallbackToQQ: boolean };
  voice: { enabled: boolean; route: string; maxChars: number };
  focus?: { enabled: boolean; updatedAt?: string; source?: string };
}

export interface SurfCoreEvent {
  id: number;
  type: 'proactive' | 'reply' | 'focus' | string;
  at: number;
  text?: string;
  modality?: 'text' | 'voice';
  messageId?: string;
  audio?: ChatAudio;
  enabled?: boolean;
}

export interface ChatReply {
  ok: boolean;
  reply?: ChatMessage;
  userMessage?: ChatMessage;
  latencyMs?: number;
  voice?: { ok: boolean; key?: string; error?: string } | null;
  error?: string;
}

export interface BubblePayload {
  messageId: string;
  text: string;
  modality: 'text' | 'voice';
  at: number;
  proactive: boolean;
  /** false = 对话框已经负责播放这条语音，气泡只显示文字和播放按钮（避免两层同时出声）。 */
  autoplay?: boolean;
  audio?: { url: string; durationMs: number };
}

export interface ChatStatePayload {
  connected: boolean;
  error: string;
  config: PetPublicConfig | null;
  focus?: boolean;
}

export interface ChatHistoryPayload extends ChatStatePayload {
  ok: boolean;
  role: { name: string };
  messages: ChatMessage[];
  pending: boolean;
}
