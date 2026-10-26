import type { LlmProvider, ServicesDescription, ToolSpec } from '../shared/services';

/**
 * 服务注册表（M2 起逐步接真实实现）。
 * 现在只描述「有什么」，不做网络与 IO —— 目的是把扩展点先定死，
 * 之后接 LLM / TTS / QQ OneBot / B 站时只需要往这里注册。
 */

const providers: LlmProvider[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requiresKey: true,
  },
  {
    id: 'ollama',
    label: 'Ollama（本地）',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    models: [],
    requiresKey: false,
  },
];

const tools: ToolSpec[] = [
  { name: 'pet.say', description: '让角色说一句话（气泡 + 口型）', risk: 'read', confirm: 'never', enabled: true },
  { name: 'pet.emote', description: '切换表情 / 播放动作', risk: 'read', confirm: 'never', enabled: true },
  { name: 'pet.sleep', description: '进入待机 / 睡眠状态', risk: 'read', confirm: 'never', enabled: true },
  { name: 'qq.read', description: '读取 QQ 未读消息', risk: 'read', confirm: 'never', enabled: false },
  { name: 'qq.reply', description: '在指定 QQ 会话里回复一条消息', risk: 'external', confirm: 'always', enabled: false },
  { name: 'bili.open', description: '打开 B 站页面陪看', risk: 'read', confirm: 'once', enabled: false },
  { name: 'bili.like', description: '给当前视频点赞', risk: 'write', confirm: 'always', enabled: false },
];

const voice = {
  tts: ['edge-tts', 'azure', 'gpt-sovits', 'system-sapi'],
  asr: ['whisper.cpp', 'web-speech', 'azure'],
};

export function describeServices(): ServicesDescription {
  return { version: 1, providers, tools, voice };
}
