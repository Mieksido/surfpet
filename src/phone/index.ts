/**
 * 电话模式：按键/自动断句的语音连续对话。
 *
 * 和 dialog（文本/语音对话窗）的区别：
 *   - dialog 是「她念给你听，你打字」；这里是「你说话，她说话」，走电话的体感。
 *   - 可以收成一个可拖动缩放的悬浮球，不常驻占屏。
 *
 * 三条硬规则（都是踩过的坑，别改）：
 *   1. 她说话（播放 TTS）期间必须停止录音，否则麦克风会把她自己的声音录进去，
 *      形成自激。即便 echoCancellation 开着，外放时仍会串音。
 *   2. 只有「自动接话」开启时才做静音断句；手动模式下按一次录一次，避免误触发。
 *   3. 识别结果为空（没人说话/纯噪声）不要发出去，否则对话会被空消息打断。
 */
import type { ChatMessage, ChatStatePayload } from '../shared/chat';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const ballEl = el<HTMLDivElement>('ball');
const ballStateEl = el<HTMLDivElement>('ballState');
const gripEl = el<HTMLDivElement>('grip');
const panelEl = el<HTMLDivElement>('panel');
const nameEl = el<HTMLDivElement>('pName');
const stateNoteEl = el<HTMLDivElement>('pState');
const orbEl = el<HTMLDivElement>('orb');
const meterFillEl = el<HTMLElement>('meterFill');
const liveEl = el<HTMLDivElement>('live');
const stateTxtEl = el<HTMLDivElement>('stateTxt');
const linesEl = el<HTMLDivElement>('lines');
const micBtn = el<HTMLButtonElement>('mic');
const autoBtn = el<HTMLButtonElement>('autoBtn');
const endBtn = el<HTMLButtonElement>('end');
const foldBtn = el<HTMLButtonElement>('fold');
const closeBtn = el<HTMLButtonElement>('close');
const player = el<HTMLAudioElement>('player');

// ── tuning ────────────────────────────────────────────────────────────────
/** 电平采样间隔 */
const CHUNK_MS = 100;
/** 超过这个 RMS 视为「有人在说话」 */
const SPEECH_RMS = 0.012;
/** 静音持续多久算一句话说完 */
const SILENCE_MS = 900;
/** 短于这个时长当作咳嗽/噪声，不送识别 */
const MIN_SPEECH_MS = 420;
/** 兜底上限，防止 VAD 一直不触发 */
const MAX_UTTER_MS = 20_000;

/** 悬浮球尺寸（px）。实际值由主进程按设置下发。 */
const BALL_MIN = 40;
const BALL_MAX = 140;

type Phase = 'idle' | 'listening' | 'capturing' | 'thinking' | 'speaking' | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: '待机',
  listening: '在听',
  capturing: '听到你了',
  thinking: '她在想',
  speaking: '她在说',
  error: '出错',
};

interface PhoneState {
  connected: boolean;
  error: string;
  config: ChatStatePayload['config'];
  collapsed: boolean;
  /** true = VAD 自动断句；false = 按一次录一次 */
  autoMode: boolean;
  listening: boolean;
  capturing: boolean;
  speaking: boolean;
  thinking: boolean;
  muted: boolean;
}

const state: PhoneState = {
  connected: false,
  error: '',
  config: null,
  collapsed: false,
  autoMode: true,
  listening: false,
  capturing: false,
  speaking: false,
  thinking: false,
  muted: false,
};

let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let analyserNode: AnalyserNode | null = null;
let levelTimer: number | null = null;

let mediaRecorder: MediaRecorder | null = null;
let recChunks: Blob[] = [];
/** 实际录制容器：ogg 优先（服务端可原生解码），webm 为后备。 */
let recFormat = 'ogg';

let utterStartedAt = 0;
let lastVoiceAt = 0;
let sawSpeech = false;

/* ─────────────────────────────── 基础渲染 ─────────────────────────────── */

function setPhase(phase: Phase, text?: string): void {
  orbEl.classList.remove('listening', 'speaking', 'thinking');
  ballEl.classList.remove('listening', 'speaking', 'thinking');
  micBtn.classList.remove('on');

  if (phase === 'listening' || phase === 'capturing') {
    orbEl.classList.add('listening');
    ballEl.classList.add('listening');
    micBtn.classList.add('on');
  } else if (phase === 'speaking') {
    orbEl.classList.add('speaking');
    ballEl.classList.add('speaking');
  } else if (phase === 'thinking') {
    orbEl.classList.add('thinking');
    ballEl.classList.add('thinking');
  }

  const label = PHASE_LABEL[phase];
  ballStateEl.textContent = label;
  stateNoteEl.textContent = `电话模式 · ${label}`;
  if (text !== undefined) stateTxtEl.textContent = text;
}

function addLine(role: 'user' | 'her', text: string): void {
  const div = document.createElement('div');
  div.className = `ln ${role === 'user' ? 'me' : 'her'}`;
  div.textContent = text;
  linesEl.append(div);
  linesEl.scrollTop = linesEl.scrollHeight;
  // 不让 DOM 无限增长
  while (linesEl.childElementCount > 40) linesEl.firstElementChild?.remove();
}

function showLive(text: string): void {
  liveEl.textContent = text || '';
}

/**
 * 按窗口尺寸缩放悬浮球里的字号。
 *
 * 收起时窗口本身就是球，所以 innerWidth 就是直径 —— 渲染进程读不到设置值，
 * 但能量到自己的视口。
 */
function fitBall(): void {
  const d = Math.min(window.innerWidth, window.innerHeight) || 56;
  const fish = Math.max(12, Math.round(d * 0.44));
  const st = Math.max(6, Math.round(d * 0.13));
  document.documentElement.style.setProperty('--fish-size', `${fish}px`);
  document.documentElement.style.setProperty('--st-size', `${st}px`);
  ballStateEl.style.display = d < 52 ? 'none' : '';
  gripEl.style.display = d < 44 ? 'none' : '';
}

/* ─────────────────────────────── 收起 / 展开 ─────────────────────────────── */

function setCollapsed(next: boolean): void {
  state.collapsed = next;
  panelEl.classList.toggle('hidden', next);
  ballEl.classList.toggle('hidden', !next);
  if (next) fitBall();
  window.pet.phone.setCollapsed(next);
}

window.addEventListener('resize', () => {
  if (state.collapsed) fitBall();
});

ballEl.addEventListener('click', (e) => {
  // 点缩放手柄时不要展开面板
  if (e.target === gripEl) return;
  setCollapsed(false);
});
foldBtn.addEventListener('click', () => setCollapsed(true));
closeBtn.addEventListener('click', () => { void shutdown(); });
endBtn.addEventListener('click', () => { void shutdown(); });

/* ───────────────────────────── 拖动缩放悬浮球 ───────────────────────────── */

let resizing = false;
let resizeStart = { x: 0, y: 0, size: 0 };

gripEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resizing = true;
  gripEl.setPointerCapture(e.pointerId);
  resizeStart = {
    x: e.screenX,
    y: e.screenY,
    size: Math.min(window.innerWidth, window.innerHeight),
  };
});

gripEl.addEventListener('pointermove', (e) => {
  if (!resizing) return;
  const dx = e.screenX - resizeStart.x;
  const dy = e.screenY - resizeStart.y;
  const delta = Math.round((dx + dy) / 2);
  const next = Math.max(BALL_MIN, Math.min(BALL_MAX, resizeStart.size + delta));
  window.pet.phone.setBallSize(next);
});

function endResize(e: PointerEvent): void {
  if (!resizing) return;
  resizing = false;
  try { gripEl.releasePointerCapture(e.pointerId); } catch { /* 已释放 */ }
}
gripEl.addEventListener('pointerup', endResize);
gripEl.addEventListener('pointercancel', endResize);

/* ─────────────────────────────── 麦克风采集 ─────────────────────────────── */

async function ensureMic(): Promise<MediaStream> {
  if (stream && stream.active) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  audioCtx = new AudioContext();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.6;
  sourceNode.connect(analyserNode);
  return stream;
}

function currentRms(): number {
  if (!analyserNode) return 0;
  const buf = new Float32Array(analyserNode.fftSize);
  analyserNode.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function updateMeter(rms: number): void {
  const pct = Math.max(0, Math.min(100, (rms / 0.15) * 100));
  meterFillEl.style.width = `${pct}%`;
  const scale = 1 + Math.min(0.12, rms * 1.6);
  orbEl.style.setProperty('--lvl', scale.toFixed(3));
}

/**
 * 优先 OGG/Opus，而不是 WebM。
 *
 * 两者编码都是 Opus，但服务端的解码器（libsndfile）能原生读 OGG，WebM 则要
 * 靠外部 ffmpeg 转码 —— 而那个 ffmpeg 进程会在 Windows 上每次识别都闪一个
 * 黑色控制台窗口。所以容器选择不是审美问题。
 */
function pickMimeType(): string {
  const candidates = [
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/webm;codecs=opus',
    'audio/webm',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'webm';
}

function startRecorder(): void {
  if (!stream) return;
  recChunks = [];
  const mime = pickMimeType();
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recChunks.push(e.data);
  };
  mediaRecorder.start(200);
  recFormat = extForMime(mime || mediaRecorder.mimeType || '');
}

async function stopRecorder(): Promise<Blob | null> {
  const rec = mediaRecorder;
  if (!rec) return null;
  mediaRecorder = null;
  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
    try { rec.stop(); } catch { resolve(); }
  });
  if (recChunks.length === 0) return null;
  return new Blob(recChunks, { type: rec.mimeType || 'audio/ogg' });
}

/* ───────────────────────────────── VAD ───────────────────────────────── */

function startLevelLoop(): void {
  stopLevelLoop();
  levelTimer = window.setInterval(() => {
    const rms = currentRms();
    updateMeter(rms);

    if (!state.autoMode) return;
    // 她说话 / 等待回复时绝不监听，否则会把自己的声音录进去。
    if (state.speaking || state.thinking) return;
    if (!state.listening) return;

    const now = Date.now();
    const voice = rms > SPEECH_RMS;

    if (!state.capturing) {
      if (voice) beginUtterance(now);
      return;
    }

    if (voice) {
      lastVoiceAt = now;
      sawSpeech = true;
    } else if (sawSpeech && now - lastVoiceAt >= SILENCE_MS) {
      void endUtterance();
    } else if (now - utterStartedAt >= MAX_UTTER_MS) {
      void endUtterance();
    }
  }, CHUNK_MS);
}

function stopLevelLoop(): void {
  if (levelTimer !== null) window.clearInterval(levelTimer);
  levelTimer = null;
}

function beginUtterance(now: number): void {
  state.capturing = true;
  utterStartedAt = now;
  lastVoiceAt = now;
  sawSpeech = true;
  startRecorder();
  setPhase('capturing', '听到你了，继续说…');
  showLive('');
}

async function endUtterance(): Promise<void> {
  if (!state.capturing) return;
  state.capturing = false;
  const duration = Date.now() - utterStartedAt;
  const blob = await stopRecorder();

  if (!blob || duration < MIN_SPEECH_MS) {
    showLive('');
    setPhase('listening', '没听清，再说一次？');
    return;
  }

  await transcribeAndSend(blob);
}

/* ──────────────────────────── 识别 + 发送 ──────────────────────────── */

async function transcribeAndSend(blob: Blob): Promise<void> {
  setPhase('thinking', '正在识别…');
  showLive('…');

  let text = '';
  try {
    const buf = await blob.arrayBuffer();
    const res = await window.pet.phone.transcribe(buf, recFormat);
    if (!res?.ok) throw new Error(res?.error || '识别失败');
    text = String(res.text || '').trim();
  } catch (error) {
    setPhase('error', `识别出错：${(error as Error)?.message ?? error}`);
    window.setTimeout(() => {
      if (state.autoMode) setPhase('listening', '继续说吧');
      else setPhase('idle', '点麦克风开始说话');
    }, 2200);
    return;
  }

  if (!text) {
    // 静音或噪声：直接回到监听，不打扰对话。
    setPhase(state.autoMode ? 'listening' : 'idle',
             state.autoMode ? '继续说吧' : '点麦克风开始说话');
    showLive('');
    return;
  }

  addLine('user', text);
  showLive(text);
  setPhase('thinking', '她在想…');

  try {
    const result = await window.pet.phone.send(text);
    if (!result?.ok) throw new Error(result?.error || '发送失败');
    // 回复通过 phone:reply 事件回来，在下面统一处理。
  } catch (error) {
    setPhase('error', `发送失败：${(error as Error)?.message ?? error}`);
    window.setTimeout(() => {
      if (state.autoMode) void beginListening();
      else setPhase('idle', '点麦克风开始说话');
    }, 2200);
  }
}

/* ──────────────────────────────── 播放 ──────────────────────────────── */

function playReply(message: ChatMessage): void {
  if (!message?.audio?.url) {
    state.thinking = false;
    addLine('her', message?.text || '');
    if (state.autoMode) void beginListening();
    else setPhase('idle', '点麦克风开始说话');
    return;
  }

  state.speaking = true;
  state.thinking = false;
  setPhase('speaking', '她正在说…');
  try {
    window.pet.phone.audioStarted();
    player.src = message.audio.url;
    void player.play().catch(() => onSpeechEnd());
  } catch {
    onSpeechEnd();
  }
}

let speechEndTimer: number | null = null;

function onSpeechEnd(): void {
  if (!state.speaking) return;
  state.speaking = false;
  if (speechEndTimer !== null) window.clearTimeout(speechEndTimer);
  // 留一点余量，别把音频尾巴当成新的一句话。
  speechEndTimer = window.setTimeout(() => {
    if (state.autoMode) void beginListening();
    else setPhase('idle', '点麦克风开始说话');
  }, 260);
}

player.addEventListener('ended', onSpeechEnd);
player.addEventListener('error', onSpeechEnd);
player.addEventListener('pause', () => {
  if (state.speaking) onSpeechEnd();
});

/* ─────────────────────────── 监听生命周期 ─────────────────────────── */

async function beginListening(): Promise<void> {
  if (state.speaking || state.thinking) return;
  if (state.muted) return;
  try {
    await ensureMic();
  } catch (error) {
    setPhase('error', `麦克风打不开：${(error as Error)?.message ?? error}`);
    return;
  }
  state.listening = true;
  setPhase('listening', state.autoMode ? '直接说话就行' : '点麦克风停止录音');
  startLevelLoop();
}

function pauseListening(): void {
  state.listening = false;
  state.capturing = false;
  stopLevelLoop();
  if (mediaRecorder) {
    try { mediaRecorder.stop(); } catch { /* 已停止 */ }
    mediaRecorder = null;
    recChunks = [];
  }
  updateMeter(0);
}

async function stopListening(): Promise<void> {
  pauseListening();
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (audioCtx) {
    try { await audioCtx.close(); } catch { /* 已关闭 */ }
    audioCtx = null;
  }
  sourceNode = null;
  analyserNode = null;
  micBtn.classList.remove('on');
}

/* ──────────────────────────────── 控件 ──────────────────────────────── */

micBtn.addEventListener('click', async () => {
  if (state.muted) {
    state.muted = false;
    micBtn.classList.remove('muted');
    await beginListening();
    return;
  }
  if (!state.listening) {
    await beginListening();
    return;
  }
  if (state.capturing) {
    await endUtterance();
    return;
  }
  pauseListening();
  state.muted = true;
  micBtn.classList.add('muted');
  setPhase('idle', '麦克风已关，点一下再开');
});

autoBtn.addEventListener('click', async () => {
  state.autoMode = !state.autoMode;
  autoBtn.textContent = state.autoMode ? '自动' : '手动';
  autoBtn.style.background = state.autoMode ? '' : 'rgba(255,255,255,.9)';
  if (state.autoMode) {
    if (!state.listening) await beginListening();
    setPhase('listening', '直接说话就行');
  } else {
    setPhase(state.listening ? 'listening' : 'idle', '点麦克风说话');
  }
});

async function shutdown(): Promise<void> {
  pauseListening();
  await stopListening();
  try { player.pause(); } catch { /* 没在播 */ }
  window.pet.phone.close();
}

/* ─────────────────────── 主进程事件接线 ─────────────────────── */

window.pet.phone.onState((next) => {
  const was = state.connected;
  state.connected = Boolean(next?.connected);
  state.error = next?.error || '';
  state.config = next?.config || null;
  nameEl.textContent = state.config?.role?.name || '小肥鱼';
  if (state.connected && !was) {
    if (state.autoMode) void beginListening();
  } else if (!state.connected) {
    setPhase('error', state.error || '连不上 SurfCore');
  }
});

window.pet.phone.onHistory((payload) => {
  const items = Array.isArray(payload?.messages) ? payload.messages : [];
  for (const m of items) {
    addLine(m.role === 'user' ? 'user' : 'her', m.text || '');
  }
  if (payload?.role?.name) nameEl.textContent = payload.role.name;
});

window.pet.phone.onReply((message) => {
  if (!message) return;
  addLine('her', message.text || '');
  showLive(message.text || '');
  playReply(message);
});

window.pet.phone.onTyping((payload) => {
  if (payload?.pending) {
    state.thinking = true;
    setPhase('thinking', '她在想…');
  } else if (state.thinking && !state.speaking) {
    state.thinking = false;
  }
});

window.pet.phone.onError((payload) => {
  setPhase('error', payload?.message || '出错了');
});

window.pet.phone.onCollapsed((v) => {
  if (v === state.collapsed) return;
  state.collapsed = v;
  panelEl.classList.toggle('hidden', v);
  ballEl.classList.toggle('hidden', !v);
  if (v) fitBall();
});

/* ──────────────────────────────── 启动 ──────────────────────────────── */

autoBtn.textContent = state.autoMode ? '自动' : '手动';
setPhase('idle', '正在连接…');
void window.pet.phone.history().catch(() => { /* 首屏历史失败不阻塞 */ });
