// Command-plugin tool. A user-configured external binary that receives
// JSON args on stdin and emits stdout. The model sees it as just another
// tool.

import { spawn } from 'node:child_process';
import type { PluginConfig } from '../config/config.js';
import type { Prompter } from '../permission/permission.js';
import type { Tool } from './types.js';

const PLUGIN_TIMEOUT_MS = 5 * 60 * 1000;

export class CommandPluginTool implements Tool {
  private readonly cfg: PluginConfig;

  constructor(cfg: PluginConfig) {
    this.cfg = cfg;
  }

  name(): string {
    return this.cfg.name;
  }

  description(): string {
    return (
      this.cfg.description ||
      'External command plugin. Receives JSON arguments on stdin and returns stdout.'
    );
  }

  schema(): Record<string, unknown> {
    return this.cfg.schema ?? { type: 'object', additionalProperties: true };
  }

  requiresPermission(): boolean {
    return this.cfg.requires_permission;
  }

  summarize(args: Record<string, unknown>): { summary: string; detail: string } {
    return {
      summary: `plugin: ${this.cfg.name}`,
      detail: `${this.cfg.command} ${this.cfg.args.join(' ')}\nstdin:\n${JSON.stringify(args, null, 2)}`,
    };
  }

  async run(
    args: Record<string, unknown>,
    parentSignal: AbortSignal,
    _p: Prompter,
  ): Promise<string> {
    if (!this.cfg.command) {
      throw new Error(`plugin ${this.cfg.name} has no command`);
    }
    return runPlugin(this.cfg.command, this.cfg.args, args, parentSignal);
  }
}

function runPlugin(
  command: string,
  argv: string[],
  args: Record<string, unknown>,
  parentSignal: AbortSignal,
): Promise<string> {
  return new Promise((resolveOut, rejectOut) => {
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', onParentAbort, { once: true });

    const timer = setTimeout(() => controller.abort(), PLUGIN_TIMEOUT_MS);
    let timedOut = false;
    timer.unref?.();

    const child = spawn(command, argv, { signal: controller.signal });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    child.on('close', (code, sig) => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (controller.signal.aborted && !parentSignal.aborted) timedOut = true;
      if (timedOut) {
        rejectOut(new Error(`plugin timed out after ${PLUGIN_TIMEOUT_MS / 1000}s`));
        return;
      }
      if (code === 0) {
        resolveOut(stderr ? `${stdout}\nstderr:\n${stderr}` : stdout);
        return;
      }
      const sigSuffix = sig ? ` (signal: ${sig})` : '';
      rejectOut(
        new Error(`plugin exited ${code}${sigSuffix}${stderr ? `: ${stderr.trim()}` : ''}`),
      );
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
      rejectOut(err);
    });

    // Send args on stdin and close it so the child knows the input is done.
    child.stdin.write(JSON.stringify(args));
    child.stdin.end();
  });
}
