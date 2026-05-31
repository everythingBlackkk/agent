// Strip <think>...</think> blocks from model output. Some local models
// (Qwen, DeepSeek-R1, GLM) emit visible reasoning blocks that aren't
// meant for the end user.

const THINK_RE = /<think>[\s\S]*?<\/think>\s*/g;

export function stripThinkingTags(s: string): string {
  if (!s.includes('<think>')) return s;
  return s.replace(THINK_RE, '').trimStart();
}
