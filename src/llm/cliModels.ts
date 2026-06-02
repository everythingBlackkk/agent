import type { Backend } from '../config/config.js';

type CliBackend = Extract<Backend, 'codex-cli' | 'gemini-cli'>;
type CliKind = 'codex' | 'gemini';

export const CLI_KIND_TO_BACKEND: Record<CliKind, CliBackend> = {
  codex: 'codex-cli',
  gemini: 'gemini-cli',
};

export const CODEX_CLI_MODEL = 'gpt-5.4-mini';
export const GEMINI_CLI_MODELS = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'] as const;
const MODEL_CATALOG: Record<CliBackend, readonly string[]> = {
  'codex-cli': [CODEX_CLI_MODEL],
  'gemini-cli': GEMINI_CLI_MODELS,
};

const MODEL_ALIASES: Record<CliBackend, Record<string, string>> = {
  'codex-cli': {
    'gpt-5.4-mini': CODEX_CLI_MODEL,
    'gpt-5.4 mini': CODEX_CLI_MODEL,
  },
  'gemini-cli': Object.fromEntries(
    GEMINI_CLI_MODELS.map((model) => [model.toLowerCase(), model]),
  ) as Record<string, string>,
};

export function isCliBackend(backend: Backend): backend is CliBackend {
  return backend === 'codex-cli' || backend === 'gemini-cli';
}

export function cliBackendFromKind(value: string): CliBackend | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'codex' || normalized === 'gemini') {
    return CLI_KIND_TO_BACKEND[normalized];
  }
  return undefined;
}

export function modelsForCliBackend(backend: CliBackend): string[] {
  return [...MODEL_CATALOG[backend]];
}

export function normalizeCliModel(backend: CliBackend, model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return MODEL_CATALOG[backend][0] ?? '';
  const key = trimmed.toLowerCase();
  const aliased = MODEL_ALIASES[backend][key];
  if (aliased) return aliased;
  throw new Error(`${backend} currently supports: ${MODEL_CATALOG[backend].join(', ')}.`);
}
