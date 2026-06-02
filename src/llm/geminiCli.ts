import type { Config } from '../config/config.js';
import {
  assertCliBinaryAvailable,
  buildCliBackendPrompt,
  parseCliBackendResponse,
  parseLooseJson,
  runCliProcess,
} from './cliCommon.js';
import { normalizeCliModel } from './cliModels.js';
import type { Client, Pinger } from './client.js';

const GEMINI_NOT_FOUND =
  'Gemini CLI was not found in PATH. Install and sign in to Gemini CLI first.';

export class GeminiCliClient implements Client, Pinger {
  readonly modelID: string;
  readonly command: string;
  readonly extraArgs: string[];
  readonly timeoutMs: number;
  readonly workingDirectory: string;

  constructor(cfg: Config) {
    this.modelID = normalizeCliModel('gemini-cli', cfg.model);
    this.command = cfg.geminiCli.command;
    this.extraArgs = [...cfg.geminiCli.extraArgs];
    this.timeoutMs = cfg.geminiCli.timeoutMs;
    this.workingDirectory = cfg.geminiCli.workingDirectory || process.cwd();
  }

  name(): string {
    return 'gemini-cli';
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
      notFoundMessage: GEMINI_NOT_FOUND,
      errorLabel: 'gemini-cli',
    });
  }

  async chat(req: import('./types.js').ChatRequest, signal?: AbortSignal) {
    const args = [
      '--prompt',
      buildCliBackendPrompt(req),
      '--output-format',
      'json',
      '--approval-mode',
      'plan',
      '--sandbox',
      '--skip-trust',
      '--model',
      this.modelID,
      ...validateExtraArgs(this.extraArgs),
    ];
    const { stdout } = await runCliProcess({
      command: this.command,
      args,
      cwd: this.workingDirectory,
      timeoutMs: this.timeoutMs,
      signal,
      notFoundMessage: GEMINI_NOT_FOUND,
      errorLabel: 'gemini-cli',
    });
    const parsed = parseLooseJson(stdout) as { response?: unknown } | undefined;
    if (!parsed || typeof parsed.response !== 'string') {
      throw new Error('gemini-cli returned no response payload');
    }
    return parseCliBackendResponse(parsed.response, 'gemini-cli');
  }
}

export function assertGeminiCliAvailable(command: string): void {
  assertCliBinaryAvailable(command, GEMINI_NOT_FOUND, ['--help'], 'gemini-cli preflight');
}

function validateExtraArgs(extraArgs: string[]): string[] {
  const blocked = [
    '--model',
    '-m',
    '--prompt',
    '-p',
    '--output-format',
    '-o',
    '--approval-mode',
    '--sandbox',
    '--yolo',
    '--allowed-tools',
    '--skip-trust',
  ];
  for (const arg of extraArgs) {
    if (blocked.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      throw new Error(`gemini-cli extraArgs must not override managed flag: ${arg}`);
    }
  }
  return [...extraArgs];
}
