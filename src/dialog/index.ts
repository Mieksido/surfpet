/** 对话窗口：文本 / 语音两种模式；回复都会同时出现在桌宠气泡里。 */
import type { ChatMessage, ChatStatePayload } from '../shared/chat';
import type { ChatMode } from '../shared/pet-api';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const messagesEl = el<HTMLDivElement>('messages');
const inputEl = el<HTMLTextAreaElement>('input');
const sendBtn = el<HTMLButtonElement>('send');
const closeBtn = el<HTMLButtonElement>('close');
const nameEl = el<HTMLDivElement>('name');
const dotEl = el<HTMLSpanElement>('dot');
const statusEl = el<HTMLSpanElement>('status');
const typingEl = el<HTMLDivElement>('typing');
const bannerEl = el<HTMLDivElement>('banner');
const bannerTextEl = el<HTMLSpanElement>('bannerText');
const retryBtn = el<HTMLButtonElement>('retry');
const dismissBtn = el<HTMLButtonElement>('dismiss');
const hintEl = el<HTMLDivElement>('hint');
const modesEl = el<HTMLDivElement>('modes');
const player = el<HTMLAudioElement>('player');

const queryMode = new URLSearchParams(location.search).get('mode');
let mode: ChatMode = queryMode === 'voice' ? 'voice' : 'text';
let state: ChatStatePayload = { connected: false, error: '', config: null };
let messages: ChatMessage[] = [];
let sending = false;
let playingId = '';
const buttons = new Map<string, HTMLButtonElement>();
let bannerTimer: number | null = null;
let roleNameOverride = '';

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDuration(ms: number): string {
  if (!ms || ms < 400) return '语音';
  return `语音 ${(Math.round(ms / 100) / 10).toFixed(1)}s`;
}

function roleName(): string {
  return state.config?.role?.name || roleNameOverride || '小肥鱼';
}

function setStatus(): void {
  const connected = state.connected;
  dotEl.classList.toggle('ok', connected);
  dotEl.classList.toggle('bad', !connected);
  nameEl.textContent = roleName();
  const modeText = mode === 'voice' ? '语音对话' : '文本对话';
  statusEl.textContent = connected ? `已连接 SurfCore · ${modeText}` : (state.error || '没连上 SurfCore');
  statusEl.title = connected ? '' : (state.error || '');
}

function applyMode(next: ChatMode, notify = true): void {
  mode = next === 'voice' ? 'voice' : 'text';
  for (const button of modesEl.querySelectorAll<HTMLButtonElement>('.mode')) {
    button.classList.toggle('on', button.dataset.mode === mode);
  }
  hintEl.textContent = mode === 'voice'
    ? '语音对话：她的回复会念出来，气泡里也会显示文字'
    : '文本对话：她的回复会出现在气泡里';
  inputEl.placeholder = mode === 'voice' ? '说点什么…（会用语音回你）' : '跟她说点什么…';
  setStatus();
  if (notify) window.pet.chat.setMode(mode);
}

function scrollToBottom(force = false): void {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  if (force || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setTyping(pending: boolean): void {
  typingEl.classList.toggle('hidden', !pending);
}

function showBanner(text: string): void {
  bannerTextEl.textContent = text;
  bannerEl.classList.remove('hidden');
  if (bannerTimer) window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => hideBanner(), 9000);
}

function hideBanner(): void {
  bannerEl.classList.add('hidden');
  if (bannerTimer) window.clearTimeout(bannerTimer);
  bannerTimer = null;
}

function setPlaying(id: string): void {
  playingId = id;
  for (const [key, button] of buttons) {
    button.classList.toggle('playing', key === id);
  }
}

function playMessage(message: ChatMessage): void {
  if (!message.audio?.url) return;
  if (playingId === message.id) {
    player.pause();
    return;
  }
  try {
    // 语音同一时间只从一处出声：对话框开始播时，主进程会让气泡先停。
    window.pet.chat.audioStarted();
    player.src = message.audio.url;
    void player.play().catch(() => setPlaying(''));
    setPlaying(message.id);
  } catch {
    setPlaying('');
  }
}

player.addEventListener('ended', () => setPlaying(''));
player.addEventListener('pause', () => setPlaying(''));
player.addEventListener('error', () => setPlaying(''));
// 窗口被最小化 / 隐藏时别再出声；否则气泡和看不见的对话框会同时播。
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  try { player.pause(); } catch {}
  setPlaying('');
});

function makeVoiceRow(message: ChatMessage): HTMLElement | null {
  if (!message.audio?.url) return null;
  const row = document.createElement('div');
  row.className = 'voice-row';
  const button = document.createElement('button');
  button.className = 'voice-play';
  button.type = 'button';
  const icon = document.createElement('span');
  icon.className = 'wave';
  icon.innerHTML = '<i></i><i></i><i></i><i></i>';
  const label = document.createElement('span');
  label.textContent = formatDuration(Number(message.audio.durationMs) || 0);
  button.append(icon, label);
  button.addEventListener('click', () => playMessage(message));
  buttons.set(message.id, button);
  row.append(button);
  return row;
}

function renderMessage(message: ChatMessage, opts: { autoplay?: boolean } = {}): void {
  const mine = message.role === 'user';
  const row = document.createElement('div');
  row.className = `row${mine ? ' me' : ''}`;
  row.dataset.id = message.id;

  if (!mine) {
    const avatar = document.createElement('div');
    avatar.className = 'mini-avatar';
    avatar.textContent = '🐟';
    row.append(avatar);
  }

  const wrap = document.createElement('div');
  wrap.className = 'bubble-wrap';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.text;

  const voiceRow = makeVoiceRow(message);
  if (voiceRow) bubble.append(voiceRow);
  wrap.append(bubble);

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (!mine && message.proactive) {
    const tag = document.createElement('span');
    tag.className = 'tag-proactive';
    tag.textContent = '主动找你';
    meta.append(tag);
  }
  if (!mine && message.modality === 'voice') {
    const tag = document.createElement('span');
    tag.textContent = '语音';
    meta.append(tag);
  }
  const time = document.createElement('span');
  time.textContent = formatTime(message.at);
  meta.append(time);
  wrap.append(meta);

  row.append(wrap);
  messagesEl.append(row);
  scrollToBottom(true);

  if (!mine && opts.autoplay && message.modality === 'voice' && message.audio?.url && !document.hidden) {
    // 新到的语音回复自动播放；历史记录 / 窗口被隐藏时不自动播（避免和气泡叠音）。
    window.setTimeout(() => playMessage(message), 120);
  }
}

function addMessage(message: ChatMessage, opts: { autoplay?: boolean } = {}): void {
  if (!message?.id || messages.some((m) => m.id === message.id)) return;
  messages.push(message);
  if (messages.length > 300) messages = messages.slice(-300);
  renderMessage(message, opts);
}

function renderAll(items: ChatMessage[]): void {
  messages = [];
  buttons.clear();
  messagesEl.innerHTML = '';
  for (const message of items) {
    if (!message?.id) continue;
    if (messages.some((m) => m.id === message.id)) continue;
    messages.push(message);
    renderMessage(message, {});
  }
  scrollToBottom(true);
}

function autoGrow(): void {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(110, Math.max(34, inputEl.scrollHeight))}px`;
}

async function send(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text || sending) return;
  if (!state.connected) {
    showBanner(state.error || '还没连上 SurfCore：先在 SurfCore 设置 → 桌宠 里启动一次');
    return;
  }
  const local: ChatMessage = {
    id: `local-${Date.now()}`,
    role: 'user',
    text,
    modality: mode,
    at: Date.now(),
  };
  addMessage(local);
  inputEl.value = '';
  autoGrow();
  sending = true;
  sendBtn.disabled = true;
  setTyping(true);
  try {
    const result = await window.pet.chat.send(text, mode);
    if (!result?.ok) {
      setTyping(false);
      showBanner(result?.error || '发送失败');
    }
  } catch (error) {
    setTyping(false);
    showBanner(String((error as Error)?.message ?? error));
  } finally {
    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

async function loadHistory(): Promise<void> {
  try {
    const history = await window.pet.chat.history();
    state = { connected: history.connected, error: history.error, config: history.config };
    roleNameOverride = history.role?.name || '';
    setStatus();
    renderAll(Array.isArray(history.messages) ? history.messages : []);
    setTyping(Boolean(history.pending));
    if (!history.connected) {
      showBanner(history.error || '连不上 SurfCore：先在设置 → 桌宠 里启动，再点「重连」');
    }
  } catch (error) {
    state = { ...state, connected: false, error: String((error as Error)?.message ?? error) };
    setStatus();
    showBanner(state.error);
  }
}

/* --------------------------------- 事件 --------------------------------- */

modesEl.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement)?.closest<HTMLButtonElement>('.mode');
  if (!target) return;
  applyMode(target.dataset.mode === 'voice' ? 'voice' : 'text', true);
  inputEl.focus();
});

sendBtn.addEventListener('click', () => { void send(); });

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
});
inputEl.addEventListener('input', autoGrow);

closeBtn.addEventListener('click', () => window.pet.chat.close());
retryBtn.addEventListener('click', () => {
  hideBanner();
  window.pet.chat.reconnect();
  showBanner('正在重连…');
});
dismissBtn.addEventListener('click', hideBanner);

window.pet.chat.onState((next) => {
  const wasConnected = state.connected;
  state = next;
  setStatus();
  if (next.connected && !wasConnected) hideBanner();
  if (!next.connected) {
    showBanner(next.error || '连不上 SurfCore');
  }
});

window.pet.chat.onMode((payload) => applyMode(payload.mode, false));

window.pet.chat.onMessage((message) => {
  if (!message) return;
  addMessage(message, { autoplay: true });
  setTyping(false);
});

window.pet.chat.onTyping((payload) => setTyping(Boolean(payload.pending)));
window.pet.chat.onError((payload) => {
  setTyping(false);
  showBanner(payload?.message || '出错了');
});
window.pet.chat.onFocusInput(() => {
  inputEl.focus();
  inputEl.select();
});
window.pet.chat.onPauseAudio(() => {
  // 气泡开始说话了：对话框这边停下，保留播放按钮，随时可以再点。
  try { player.pause(); } catch {}
  setPlaying('');
});

/* --------------------------------- 启动 --------------------------------- */

applyMode(mode, false);
setStatus();
void loadHistory().then(() => inputEl.focus());
