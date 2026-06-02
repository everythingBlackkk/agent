import type { Config } from '../config/config.js';
import {
  assertCliBinaryAvailable,
  buildCliBackendPrompt,
  parseCliBackendResponse,
  runCliProcess,
} from './cliCommon.js';
import { normalizeCliModel } from './cliModels.js';
import type { Client, Pinger } from './client.js';

const COPILOT_NOT_FOUND =
  'Copilot CLI was not found in PATH. Install and sign in to Copilot CLI first.';

interface CopilotEvent {
  type?: unknown;
  data?: {
    content?: unknown;
  };
}

export class CopilotCliClient implements Client, Pinger {
  readonly modelID: string;
  readonly command: string;
  readonly extraArgs: string[];
  readonly timeoutMs: number;
  readonly workingDirectory: string;
  readonly effort: string;

  constructor(cfg: Config) {
    this.modelID = normalizeCliModel('copilot-cli', cfg.model);
    this.command = cfg.copilotCli.command;
    this.extraArgs = [...cfg.copilotCli.extraArgs];
    this.timeoutMs = cfg.copilotCli.timeoutMs;
    this.workingDirectory = cfg.copilotCli.workingDirectory || process.cwd();
    this.effort = cfg.copilotCli.effort;
  }

  name(): string {
    return 'copilot-cli';
  }

  model(): string {
    return this.modelID;
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await runCliProcess({
      command: this.command,
      args: ['--help'],
      cwd: this.workingDirectory,
      timeoutMs: Math.min(this.timeoutMs, 5_000),
      signal,
      notFoundMessage: COPILOT_NOT_FOUND,
      errorLabel: 'copilot-cli',
    });
  }

  async chat(req: import('./types.js').ChatRequest, signal?: AbortSignal) {
    const args = [
      '-p',
      buildCliBackendPrompt(req),
      '--output-format',
      'json',
      '--stream',
      'off',
      '--available-tools=',
      '--disable-builtin-mcps',
      '--no-custom-instructions',
      '--no-remote',
      '--model',
      this.modelID,
      '--effort',
      this.effort,
      '-C',
      this.workingDirectory,
      ...validateExtraArgs(this.extraArgs),
    ];
    const { stdout } = await runCliProcess({
      command: this.command,
      args,
      cwd: this.workingDirectory,
      timeoutMs: this.timeoutMs,
      signal,
      notFoundMessage: COPILOT_NOT_FOUND,
      errorLabel: 'copilot-cli',
    });
    return parseCopilotAssistantContent(extractAssistantContent(stdout));
  }
}

export function assertCopilotCliAvailable(command: string): void {
  assertCliBinaryAvailable(command, COPILOT_NOT_FOUND, ['--help'], 'copilot-cli preflight');
}

export function parseCopilotAssistantContent(content: string): import('./types.js').ChatResponse {
  try {
    return parseCliBackendResponse(content, 'copilot-cli');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('invalid JSON content')) throw err;
    return {
      message: { role: 'assistant', content },
      finishReason: 'stop',
    };
  }
}

function extractAssistantContent(stdout: string): string {
  let finalContent = '';
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: CopilotEvent;
    try {
      parsed = JSON.parse(trimmed) as CopilotEvent;
    } catch {
      continue;
    }
    if (parsed.type === 'assistant.message' && typeof parsed.data?.content === 'string') {
      finalContent = parsed.data.content;
    }
  }
  if (!finalContent) throw new Error('copilot-cli returned no assistant response');
  return finalContent;
}

function validateExtraArgs(extraArgs: string[]): string[] {
  const blocked = [
    '--model',
    '--output-format',
    '--stream',
    '--available-tools',
    '--disable-builtin-mcps',
    '--no-custom-instructions',
    '--no-remote',
    '--effort',
    '--reasoning-effort',
    '-C',
    '-p',
    '--prompt',
    '--allow-all',
    '--allow-all-tools',
    '--yolo',
  ];
  for (const arg of extraArgs) {
    if (blocked.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      throw new Error(`copilot-cli extraArgs must not override managed flag: ${arg}`);
    }
  }
  return [...extraArgs];
}
