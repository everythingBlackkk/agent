import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config/config.js';
import {
  CODEX_CLI_MODEL,
  CodexCliClient,
  buildCodexExecArgs,
  codexCliNotFoundMessage,
  normalizeCodexCliModel,
  parseCodexResponse,
  stripAnsi,
} from './codexCli.js';
import type { ChatRequest } from './types.js';

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

class MockChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null));
    return true;
  });
}

function baseRequest(): ChatRequest {
  return {
    model: CODEX_CLI_MODEL,
    messages: [{ role: 'user', content: 'say hi' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'shell',
          description: 'Run a command',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      },
    ],
  };
}

describe('codex-cli backend', () => {
  beforeEach(() => {
    vi.useRealTimers();
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ stdout: '--ask-for-approval', stderr: '' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the expected codex exec command', () => {
    const args = buildCodexExecArgs(
      {
        command: 'codex',
        extraArgs: ['--profile', 'work'],
        timeoutMs: 120000,
        workingDirectory: '',
      },
      CODEX_CLI_MODEL,
      '/tmp/session',
      '/tmp/schema.json',
      '/tmp/output.json',
    );

    expect(args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-rules',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--output-schema',
      '/tmp/schema.json',
      '--output-last-message',
      '/tmp/output.json',
      '-C',
      '/tmp/session',
      '--ask-for-approval',
      'never',
      '--model',
      CODEX_CLI_MODEL,
      '--profile',
      'work',
      '-',
    ]);
  });

  it('omits unsupported flags for older codex exec versions', () => {
    const args = buildCodexExecArgs(
      {
        command: 'codex',
        extraArgs: [],
        timeoutMs: 120000,
        workingDirectory: '',
      },
      CODEX_CLI_MODEL,
      '/tmp/session',
      '/tmp/schema.json',
      '/tmp/output.json',
      { supportsAskForApproval: false },
    );

    expect(args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-rules',
      '--color',
      'never',
      '--sandbox',
      'read-only',
      '--output-schema',
      '/tmp/schema.json',
      '--output-last-message',
      '/tmp/output.json',
      '-C',
      '/tmp/session',
      '--model',
      CODEX_CLI_MODEL,
      '-',
    ]);
  });

  it('normalizes blank codex-cli model to gpt-5.4-mini', () => {
    expect(normalizeCodexCliModel('')).toBe(CODEX_CLI_MODEL);
  });

  it('rejects unsupported codex-cli models', () => {
    expect(() => normalizeCodexCliModel('gpt-5.3-codex')).toThrow(
      /only supports model gpt-5.4-mini/,
    );
  });

  it('parses structured output into assistant text and tool calls', () => {
    const out = parseCodexResponse(
      JSON.stringify({
        content: 'Need a shell command.',
        tool_calls: [{ name: 'shell', arguments: '{"command":"pwd"}' }],
      }),
    );

    expect(out.finishReason).toBe('tool_calls');
    expect(out.message.content).toBe('Need a shell command.');
    expect(out.message.toolCalls?.[0]?.function.name).toBe('shell');
    expect(out.message.toolCalls?.[0]?.function.arguments).toBe('{"command":"pwd"}');
  });

  it('strips ansi escape codes', () => {
    expect(stripAnsi('\u001B[31merror\u001B[0m')).toBe('error');
  });

  it('returns a clear error when codex is missing', async () => {
    spawnSyncMock.mockReturnValue({ error: { code: 'ENOENT' } });

    const cfg = defaultConfig();
    cfg.backend = 'codex-cli';

    const { newFromConfig } = await import('./factory.js');
    expect(() => newFromConfig(cfg)).toThrow(codexCliNotFoundMessage());
  });

  it('parses the subprocess output file correctly', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new MockChild();
      const outputPath = args[args.indexOf('--output-last-message') + 1];
      if (!outputPath) throw new Error('missing output path');
      void import('node:fs/promises').then(({ writeFile }) =>
        writeFile(
          outputPath,
          JSON.stringify({
            content: 'Planned response',
            tool_calls: [{ name: 'shell', arguments: '{"command":"id"}' }],
          }),
        ).then(() => {
          child.stdout.write('\u001B[32mignored\u001B[0m');
          child.emit('close', 0);
        }),
      );
      return child;
    });

    const cfg = defaultConfig();
    cfg.backend = 'codex-cli';
    cfg.model = CODEX_CLI_MODEL;
    const client = new CodexCliClient(cfg);

    const resp = await client.chat(baseRequest());

    expect(resp.message.content).toBe('Planned response');
    expect(resp.message.toolCalls?.[0]?.function.name).toBe('shell');
    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      expect.arrayContaining(['exec', '--sandbox', 'read-only']),
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });

  it('handles non-zero exit codes cleanly', async () => {
    spawnMock.mockImplementation(() => {
      const child = new MockChild();
      queueMicrotask(() => {
        child.stderr.write(
          'ERROR: {"type":"error","error":{"message":"The model is not supported for this account."},"status":400}',
        );
        child.emit('close', 1);
      });
      return child;
    });

    const cfg = defaultConfig();
    cfg.backend = 'codex-cli';
    const client = new CodexCliClient(cfg);

    await expect(client.chat(baseRequest())).rejects.toThrow(
      /codex-cli exited non-zero: The model is not supported for this account\./,
    );
  });

  it('handles timeouts cleanly', async () => {
    spawnMock.mockImplementation(() => new MockChild());

    const cfg = defaultConfig();
    cfg.backend = 'codex-cli';
    cfg.codexCli.timeoutMs = 10;
    const client = new CodexCliClient(cfg);

    await expect(client.chat(baseRequest())).rejects.toThrow(/codex-cli timed out after 10ms/);
  }, 10000);
});
