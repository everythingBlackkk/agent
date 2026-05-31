// File-only structured logger.: writes JSON lines
// to ~/.pentesterflow/logs/pentesterflow.log, never to stdout/stderr (the
// TUI owns those), rotates at 4 MB by keeping pentesterflow.log.1.
//
// pino under the hood. Default logger is no-op so callers don't need to
// error-handle setup.

import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import pino, { type Logger } from 'pino';

const MAX_LOG_BYTES = 4 * 1024 * 1024;

let current: Logger = pino({ enabled: false });

/**
 * Initialise the logger. Opens or creates the log file at `path` and
 * installs a pino logger that writes to it. If `path` is empty, defaults
 * to `~/.pentesterflow/logs/pentesterflow.log`. On any setup error the
 * logger stays disabled so the caller doesn't need to error-handle.
 */
export function init(path?: string): void {
  const target = path && path.length > 0 ? path : defaultLogPath();
  if (!target) return;

  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    rotateIfTooBig(target);
    // Sync writes: a short-lived CLI command (--list-skills, --version,
    // --list-tools) shouldn't have to await pino's async drain on exit.
    // The throughput cost is irrelevant for this scale of logging.
    const stream = pino.destination({ dest: target, sync: true, append: true });
    current = pino(
      {
        base: { pid: process.pid },
        timestamp: pino.stdTimeFunctions.isoTime,
        level: process.env.PENTESTERFLOW_LOG_LEVEL ?? 'info',
      },
      stream,
    );
  } catch {
    // Stay disabled on any setup failure.
    current = pino({ enabled: false });
  }
}

function defaultLogPath(): string | undefined {
  const home = homedir();
  if (!home) return undefined;
  return join(home, '.pentesterflow', 'logs', 'pentesterflow.log');
}

function rotateIfTooBig(path: string): void {
  if (!existsSync(path)) return;
  try {
    const info = statSync(path);
    if (info.size <= MAX_LOG_BYTES) return;
    renameSync(path, `${path}.1`);
  } catch {
    // Best effort.
  }
}

export function logger(): Logger {
  return current;
}

export function info(msg: string, args?: Record<string, unknown>): void {
  current.info(args ?? {}, msg);
}

export function warn(msg: string, args?: Record<string, unknown>): void {
  current.warn(args ?? {}, msg);
}

export function error(msg: string, args?: Record<string, unknown>): void {
  current.error(args ?? {}, msg);
}

export function debug(msg: string, args?: Record<string, unknown>): void {
  current.debug(args ?? {}, msg);
}
