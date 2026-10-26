/** 气泡窗口：显示小肥鱼说的每一句话（语音也会显示文字），并带「回复」按钮。 */
import type { BubblePayload } from '../shared/chat';

const bubbleEl = document.getElementById('bubble') as HTMLDivElement;
const textEl = document.getElementById('text') as HTMLDivElement;
const tagEl = document.getElementById('tag') as HTMLSpanElement;
const replyBtn = document.getElementById('reply') as HTMLButtonElement;
const closeBtn = document.getElementById('close') as HTMLButtonElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const playIcon = document.getElementById('playIcon') as HTMLSpanElement;
const durEl = document.getElementById('dur') as HTMLSpanElement;
const audioEl = document.getElementById('audio') as HTMLAudioElement;

let current: BubblePayload | null = null;
let sizeTimer = 0;

function formatDuration(ms: number): string {
  if (!ms || ms < 400) return '';
  const seconds = Math.round(ms / 100) / 10;
  return `${seconds}s`;
}

function reportSize(): void {
  if (sizeTimer) cancelAnimationFrame(sizeTimer);
  sizeTimer = requestAnimationFrame(() => {
    const root = document.getElementById('root');
    const height = Math.ceil((root?.getBoundingClientRect().height ?? 0) + 2);
    const width = Math.max(220, Math.ceil(window.innerWidth));
    if (height > 0) window.pet.bubble.resize(width, height);
  });
}

function setPlaying(playing: boolean): void {
  playBtn.classList.toggle('playing', playing);
  playIcon.textContent = playing ? '❚❚' : '▶';
}

function stopAudio(): void {
  try {
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  } catch {}
  setPlaying(false);
}

async function playAudio(): Promise<void> {
  if (!current?.audio?.url) return;
  try {
    // 告诉主进程「气泡开始出声了」，它会先让对话框停下（避免回音）。
    window.pet.bubble.audioStarted();
    if (audioEl.src !== current.audio.url) audioEl.src = current.audio.url;
    await audioEl.play();
  } catch {
    setPlaying(false);
  }
}

function show(payload: BubblePayload): void {
  current = payload;
  textEl.textContent = payload.text;
  tagEl.classList.toggle('hidden', !payload.proactive);
  bubbleEl.classList.remove('out');
  bubbleEl.classList.add('in');
  stopAudio();
  if (payload.modality === 'voice' && payload.audio?.url) {
    playBtn.classList.remove('hidden');
    durEl.textContent = formatDuration(Number(payload.audio.durationMs) || 0);
    audioEl.src = payload.audio.url;
    // 对话框可见时由它播放；这里只显示播放按钮，点一下才会由气泡接手。
    if (payload.autoplay !== false) void playAudio();
  } else {
    playBtn.classList.add('hidden');
    durEl.textContent = '';
  }
  reportSize();
  setTimeout(reportSize, 80);
}

function hide(): void {
  bubbleEl.classList.remove('in');
  bubbleEl.classList.add('out');
  stopAudio();
}

replyBtn.addEventListener('click', () => {
  if (!current) return;
  window.pet.bubble.action('reply', current.messageId);
});

closeBtn.addEventListener('click', () => {
  window.pet.bubble.action('close');
  hide();
});

playBtn.addEventListener('click', () => {
  if (audioEl.paused) void playAudio();
  else {
    audioEl.pause();
    setPlaying(false);
  }
});

audioEl.addEventListener('play', () => setPlaying(true));
audioEl.addEventListener('pause', () => setPlaying(false));
audioEl.addEventListener('ended', () => setPlaying(false));
audioEl.addEventListener('error', () => setPlaying(false));

document.body.addEventListener('mouseenter', () => window.pet.bubble.hover(true));
document.body.addEventListener('mouseleave', () => window.pet.bubble.hover(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.pet.bubble.action('close');
    hide();
  }
});
window.addEventListener('resize', reportSize);

window.pet.bubble.onShow(show);
window.pet.bubble.onHide(hide);
window.pet.bubble.onPauseAudio(() => {
  // 对话框开始说话了：气泡只保留文字，声音交给它。
  try { audioEl.pause(); } catch {}
  setPlaying(false);
});
window.pet.bubble.ready();
