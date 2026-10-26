/** 服务层对外契约：LLM / 语音 / 工具。渲染进程和未来设置面板只依赖这里的类型。 */

export type ProviderKind = 'openai-compatible' | 'ollama';

export interface LlmProvider {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** 预设模型名；空数组表示运行时从 /models 拉取（如 Ollama） */
  models: string[];
  requiresKey: boolean;
}

export type ToolRisk = 'read' | 'write' | 'external';
export type ToolConfirm = 'never' | 'once' | 'always';

export interface ToolSpec {
  name: string;
  description: string;
  risk: ToolRisk;
  confirm: ToolConfirm;
  /** 尚未实现的工具先关着，UI 里显示为「未接入」 */
  enabled: boolean;
}

export interface ServicesDescription {
  version: number;
  providers: LlmProvider[];
  tools: ToolSpec[];
  voice: { tts: string[]; asr: string[] };
}
