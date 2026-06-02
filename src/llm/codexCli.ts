import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config/config.js';
import {
  assertCliBinaryAvailable,
  buildCliBackendPrompt,
  parseCliBackendResponse,
  runCliProcess,
  stripAnsi,
} from './cliCommon.js';
import { CODEX_CLI_MODEL, normalizeCliModel } from './cliModels.js';
import type { Client, Pinger } from './client.js';

const CODEX_NOT_FOUND = 'Codex CLI was not found in PATH. Install and sign in to Codex CLI first.';

interface CodexExecCapabilities {
  supportsAskForApproval: boolean;
}

const capabilityCache = new Map<string, CodexExecCapabilities>();

export { CODEX_CLI_MODEL };

export function assertCodexCliAvailable(command: string): void {
  assertCliBinaryAvailable(command, CODEX_NOT_FOUND, ['--version'], 'codex-cli preflight');
}

export function codexCliNotFoundMessage(): string {
  return CODEX_NOT_FOUND;
}

export function normalizeCodexCliModel(model: string): string {
  try {
    return normalizeCliModel('codex-cli', model);
  } catch {
    throw new Error(`codex-cli currently only supports model ${CODEX_CLI_MODEL} in PentesterFlow.`);
  }
}

export function parseCodexResponse(raw: string) {
  return parseCliBackendResponse(raw, 'codex-cli');
}

export { stripAnsi };

export function buildCodexExecArgs(
  cfg: Config['codexCli'],
  model: string,
  workingDirectory: string,
  schemaPath: string,
  outputPath: string,
  capabilities: CodexExecCapabilities = { supportsAskForApproval: true },
): string[] {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-rules',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
    '-C',
    workingDirectory,
  ];
  if (capabilities.supportsAskForApproval) args.push('--ask-for-approval', 'never');
  if (model) args.push('--model', model);
  args.push(...validateExtraArgs(cfg.extraArgs), '-');
  return args;
}

export class CodexCliClient implements Client, Pinger {
  readonly modelID: string;
  readonly command: string;
  readonly extraArgs: string[];
  readonly timeoutMs: number;
  readonly workingDirectory: string;
  readonly capabilities: CodexExecCapabilities;

  constructor(cfg: Config) {
    this.modelID = normalizeCodexCliModel(cfg.model);
    this.command = cfg.codexCli.command;
    this.extraArgs = [...cfg.codexCli.extraArgs];
    this.timeoutMs = cfg.codexCli.timeoutMs;
    this.workingDirectory = cfg.codexCli.workingDirectory || process.cwd();
    this.capabilities = detectCodexExecCapabilities(this.command);
  }

  name(): string {
    return 'codex-cli';
  }

  model(): string {
    return this.modelID;
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await runCliProcess({
      command: this.command,
      args: ['--version'],
      cwd: this.workingDirectory,
      timeoutMs: Math.min(this.timeoutMs, 5_000),
      signal,
      notFoundMessage: CODEX_NOT_FOUND,
      errorLabel: 'codex-cli',
    });
  }

  async chat(req: import('./types.js').ChatRequest, signal?: AbortSignal) {
    const dir = await mkdtemp(join(tmpdir(), 'pentesterflow-codex-'));
    const schemaPath = join(dir, 'schema.json');
    const outputPath = join(dir, 'response.json');
    try {
      await writeFile(schemaPath, JSON.stringify(codexOutputSchema()), 'utf8');
      const args = buildCodexExecArgs(
        {
          command: this.command,
          extraArgs: this.extraArgs,
          timeoutMs: this.timeoutMs,
          workingDirectory: this.workingDirectory,
        },
        this.modelID,
        this.workingDirectory,
        schemaPath,
        outputPath,
        this.capabilities,
      );
      await runCliProcess({
        command: this.command,
        args,
        cwd: this.workingDirectory,
        timeoutMs: this.timeoutMs,
        stdin: buildCliBackendPrompt(req),
        signal,
        notFoundMessage: CODEX_NOT_FOUND,
        errorLabel: 'codex-cli',
      });
      return parseCodexResponse(await readFile(outputPath, 'utf8'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function codexOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['content', 'tool_calls'],
    properties: {
      content: { type: 'string' },
      tool_calls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'arguments'],
          properties: {
            name: { type: 'string' },
            arguments: { type: 'string' },
          },
        },
      },
    },
  };
}

function validateExtraArgs(extraArgs: string[]): string[] {
  const blocked = [
    '--dangerously-bypass-approvals-and-sandbox',
    '--dangerously-bypass-hook-trust',
    '--sandbox',
    '-s',
    '--ask-for-approval',
    '-a',
    '--output-schema',
    '--output-last-message',
    '-o',
    '--json',
    '--cd',
    '-C',
    '--search',
  ];
  for (const arg of extraArgs) {
    if (blocked.some((flag) => arg === flag || arg.startsWith(`${flag}=`))) {
      throw new Error(`codex-cli extraArgs must not override managed flag: ${arg}`);
    }
  }
  return [...extraArgs];
}

function detectCodexExecCapabilities(command: string): CodexExecCapabilities {
  const cached = capabilityCache.get(command);
  if (cached) return cached;

  const result = spawnSync(command, ['exec', '--help'], { encoding: 'utf8' });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new Error(CODEX_NOT_FOUND);
  }
  if (result.error) {
    throw new Error(`codex-cli capability probe failed: ${result.error.message}`);
  }

  const help = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const detected = {
    supportsAskForApproval: help.includes('--ask-for-approval'),
  };
  capabilityCache.set(command, detected);
  return detected;
}
