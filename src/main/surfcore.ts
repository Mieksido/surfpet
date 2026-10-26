/**
 * 桌宠 ↔ SurfCore 的连接层（主进程）。
 *
 * 发现方式：SurfCore 插件把 { baseUrl, token } 写到 ~/.dsh/surfcore/pet/host.json
 * （DSH 端口漂移 / 插件重启后会重写）。桌宠不需要 DSH 的会话 Cookie：
 * 走插件单独注册的 /dsh-surfcore/pet-api/*，只认回环 + 这把本地令牌。
 *
 * 职责：
 *   · 长轮询 /events（主动搭话、配置变化）；
 *   · /chat 一问一答（文本或语音，语音会带回 wav 播放地址）；
 *   · /history /config /status；
 *   · 断线自动重连并重新读 host.json。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ChatAudio, ChatMessage, ChatReply, PetPublicConfig, SurfCoreEvent,
} from '../shared/chat';

export type { ChatAudio, ChatMessage, ChatReply, PetPublicConfig, SurfCoreEvent } from '../shared/chat';

export interface SurfCoreHost {
  baseUrl: string;
  token: string;
  api: string;
  pluginVersion?: string;
  updatedAt?: string;
}

interface PollPayload {
  ok: boolean;
  bootId: string;
  cursor: number;
  events: SurfCoreEvent[];
  config?: PetPublicConfig;
  serverTime: number;
}

const CLIENT_ID = `pet-${randomUUID().slice(0, 8)}`;

function dshHome(): string {
  return String(process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh');
}

export function hostFilePath(): string {
  return String(process.env.SURFCORE_PET_HOST || '').trim()
    || path.join(dshHome(), 'surfcore', 'pet', 'host.json');
}

/** 小步退避：断线时别把 CPU 和日志刷满，但也要能在 DSH 重启后几秒内接上。 */
function backoffMs(attempt: number): number {
  return Math.min(15000, 1500 + attempt * 1500);
}

export class SurfCoreClient extends EventEmitter {
  private host: SurfCoreHost | null = null;
  private connected = false;
  private bootId = '';
  private cursor = 0;
  // 插件重启后事件序号从 1 重新开始：旧的游标会大于服务端当前序号，
  // 必须在下一轮用「不带 since」的请求重新取水位，否则永远收不到新事件。
  private needsBaseline = false;
  private stopped = true;
  private pollTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private lastError = '';
  private configCache: PetPublicConfig | null = null;
  private polling = false;
  private pollAbort: AbortController | null = null;

  get info(): SurfCoreHost | null {
    return this.host;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get lastConnectError(): string {
    return this.lastError;
  }

  get config(): PetPublicConfig | null {
    return this.configCache;
  }

  /** 读 host.json。文件不存在 / 不完整时返回 null，不抛。 */
  readHost(): SurfCoreHost | null {
    try {
      const raw = JSON.parse(fs.readFileSync(hostFilePath(), 'utf8')) as Partial<SurfCoreHost>;
      const baseUrl = String(raw.baseUrl || '').replace(/\/+$/, '');
      const token = String(raw.token || '');
      if (!/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(baseUrl) || !/^[a-f0-9]{32,80}$/i.test(token)) return null;
      const api = typeof raw.api === 'string' && raw.api.startsWith('/') ? raw.api : '/dsh-surfcore/pet-api';
      this.host = { baseUrl, token, api, pluginVersion: raw.pluginVersion, updatedAt: raw.updatedAt };
      return this.host;
    } catch {
      return null;
    }
  }

  private async ensureHost(refresh = false): Promise<SurfCoreHost> {
    if (!refresh && this.host) return this.host;
    const host = this.readHost();
    if (!host) throw new Error('还没找到 SurfCore（~/.dsh/surfcore/pet/host.json）：先在 SurfCore 设置 → 桌宠 里启动一次');
    return host;
  }

  private async request<T>(
    pathname: string,
    options: { method?: string; body?: unknown; timeoutMs?: number; host?: SurfCoreHost; signal?: AbortSignal } = {},
  ): Promise<T> {
    const host = options.host ?? (await this.ensureHost());
    const url = `${host.baseUrl}${host.api}${pathname}`;
    const timeoutSignal = AbortSignal.timeout(Math.max(1000, options.timeoutMs ?? 20000));
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
    try {
      const init: RequestInit = {
        method: options.method ?? 'GET',
        headers: {
          'x-pet-token': host.token,
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        } as Record<string, string>,
        signal,
      };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      const res = await fetch(url, init);
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!res.ok) {
        const message = String(data?.error || `SurfCore HTTP ${res.status}`);
        const error = new Error(message) as Error & { status?: number };
        error.status = res.status;
        throw error;
      }
      return (data ?? {}) as T;
    } finally {
      // 超时/外部取消都由 AbortSignal 管理，这里不需要额外清理。
    }
  }

  absoluteUrl(relative: string): string {
    if (!relative) return '';
    if (/^https?:\/\//i.test(relative)) return relative;
    const host = this.host;
    if (!host) return '';
    return `${host.baseUrl}${relative.startsWith('/') ? '' : '/'}${relative}`;
  }

  private setConnected(next: boolean, error = '') {
    if (error) this.lastError = error;
    if (this.connected === next && !error) return;
    this.connected = next;
    this.emit('connection', { connected: next, error: next ? '' : (error || this.lastError) });
    if (next) this.lastError = '';
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.pollTimer = null;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    // 长轮询可能还挂在 25 秒的 wait 上：主动断掉，重连不用等它自然超时。
    try { this.pollAbort?.abort(); } catch {}
    this.pollAbort = null;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => { void this.loop(); }, Math.max(500, ms));
  }

  private async loop(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      // 第一次（或插件重启后 bootId 变了）：不带 since，只取当前水位，不重放旧气泡。
      const wantsSince = Boolean(this.bootId) && !this.needsBaseline;
      const query = wantsSince
        ? `?since=${this.cursor}&wait=25000&client=${CLIENT_ID}`
        : `?wait=0&client=${CLIENT_ID}`;
      let payload: PollPayload;
      const controller = new AbortController();
      this.pollAbort = controller;
      try {
        payload = await this.request<PollPayload>(`/events${query}`, { timeoutMs: 40000, signal: controller.signal });
      } catch (error) {
        // 端口漂移 / 插件重启：先重读 host.json，再决定是不是真的断线。
        this.readHost();
        throw error;
      } finally {
        this.pollAbort = null;
      }
      if (payload.bootId && payload.bootId !== this.bootId) {
        // 插件刚重启：游标失效，本轮先不认 since，下轮重新取水位。
        this.bootId = payload.bootId;
        this.cursor = Number(payload.cursor) || 0;
        this.needsBaseline = true;
      } else {
        this.bootId = payload.bootId || this.bootId;
        this.cursor = Number(payload.cursor) || this.cursor;
        this.needsBaseline = false;
        for (const event of payload.events ?? []) {
          if (event && event.type === 'proactive') this.emit('proactive', event);
          this.emit('event', event);
        }
      }
      if (payload.config) {
        this.configCache = payload.config;
        this.emit('config', payload.config);
      }
      this.attempt = 0;
      this.setConnected(true);
      // 长轮询正常返回（有事件/超时）就立刻续上；短等待留给异常分支。
      this.schedule(50);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      this.attempt += 1;
      this.setConnected(false, message);
      this.schedule(backoffMs(this.attempt));
    } finally {
      this.polling = false;
    }
  }

  /** 主动重连一次（右键/设置里点「重连」时用）。 */
  reconnect(): void {
    this.stop();
    this.bootId = '';
    this.cursor = 0;
    this.start();
  }

  async chat(text: string, modality: 'text' | 'voice'): Promise<ChatReply> {
    return this.request<ChatReply>('/chat', {
      method: 'POST',
      body: { text, modality },
      timeoutMs: 180000,
    });
  }

  async history(limit = 60): Promise<{ ok: boolean; role?: { name: string }; messages: ChatMessage[]; error?: string }> {
    return this.request(`/history?limit=${encodeURIComponent(String(limit))}`, { timeoutMs: 15000 });
  }

  /** 专注模式：由插件写 pet/focus.json；桌宠菜单/设置页共用这一份。 */
  async setFocus(enabled: boolean): Promise<{ ok: boolean; focus?: { enabled: boolean; updatedAt?: string; source?: string }; error?: string }> {
    return this.request('/focus', { method: 'POST', body: { enabled: enabled === true, source: 'pet' }, timeoutMs: 10000 });
  }

  async fetchConfig(): Promise<PetPublicConfig> {
    const config = await this.request<PetPublicConfig & { ok: boolean }>('/config', { timeoutMs: 10000 });
    this.configCache = config;
    return config;
  }

  async status(): Promise<any> {
    return this.request('/status', { timeoutMs: 10000 });
  }
}
