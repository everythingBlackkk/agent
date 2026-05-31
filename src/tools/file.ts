// File read / write / edit tools. Reads of paths on the sensitive-path
// denylist require an explicit user prompt; other reads go through
// frictionless. Writes and edits always require permission (handled by
// the registry).

import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { Prompter } from '../permission/permission.js';
import { isSensitivePath } from './sensitive.js';
import { type Tool, argBool, argString } from './types.js';

const READ_BYTE_CAP = 200 * 1024;

/**
 * Resolve a path to its real on-disk location so a symlink (e.g.
 * ./notes -> ~/.ssh/id_rsa) can't smuggle a credential file past the
 * sensitive-path gate. `resolve()` only normalizes `..`; it does NOT
 * follow links. For a not-yet-existing target (write/edit of a new file)
 * we realpath the parent directory instead, so a symlinked parent dir is
 * also caught. Falls back to the lexical path if nothing on disk resolves.
 */
async function realResolve(abs: string): Promise<string> {
  try {
    return await realpath(abs);
  } catch {
    try {
      return resolve(await realpath(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * Prompt before touching a sensitive path. The path is sensitive if EITHER
 * the lexical path or its symlink-resolved real path matches the denylist:
 * checking the lexical path keeps listed entries like /etc/shadow matching
 * even where realpath would canonicalize them (e.g. /private/etc on macOS),
 * while checking the real path defeats symlink smuggling. Flagged
 * bypassYolo + noSessionCache so the prompt fires even in YOLO and is never
 * silently re-granted for the session. `verb` is "read"/"write to"/"edit".
 * Throws on deny.
 */
async function gateSensitive(
  p: Prompter,
  abs: string,
  verb: string,
  signal: AbortSignal,
): Promise<void> {
  const real = await realResolve(abs);
  if (!isSensitivePath(abs) && !isSensitivePath(real)) return;
  const shown = real !== abs ? `${abs}\nresolves to: ${real}` : abs;
  const decision = await p.ask(
    {
      tool: 'file',
      summary: `${verb} sensitive file: ${real}`,
      detail: `path: ${shown}\n\nThis path is on the sensitive-path list (private keys, cloud credentials, shell history, config dirs, etc.). Approve only if you intend to ${verb} it.`,
      bypassYolo: true,
      noSessionCache: true,
    },
    signal,
  );
  if (decision === 'deny') {
    throw new Error(`${verb} of sensitive path denied: ${real}`);
  }
}

export class FileReadTool implements Tool {
  private readonly toolName: string;
  constructor(toolName = 'file_read') {
    this.toolName = toolName;
  }
  name(): string {
    return this.toolName;
  }
  description(): string {
    return 'Read a UTF-8 file from disk. Use for inspecting recon output, wordlists, notes, exploit code. Returns up to 200KB; use shell+head for larger files. Reads of paths under ~/.ssh, ~/.aws, shell history files, etc. require explicit user approval.';
  }
  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to file.' },
      },
      required: ['path'],
    };
  }
  /** Sensitive paths are gated inline in run(); ordinary reads are frictionless. */
  requiresPermission(): boolean {
    return false;
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, p: Prompter): Promise<string> {
    const path = argString(args, 'path');
    if (!path) throw new Error('path is required');
    const abs = resolve(path);

    await gateSensitive(p, abs, 'read', signal);

    const buf = await readFile(abs);
    if (buf.byteLength > READ_BYTE_CAP) {
      const head = buf.subarray(0, READ_BYTE_CAP).toString('utf8');
      return `${head}\n[... truncated ${buf.byteLength - READ_BYTE_CAP} bytes ...]`;
    }
    return buf.toString('utf8');
  }
}

export class FileWriteTool implements Tool {
  private readonly toolName: string;
  constructor(toolName = 'file_write') {
    this.toolName = toolName;
  }
  name(): string {
    return this.toolName;
  }
  description(): string {
    return 'Write content to a file, creating or overwriting it. Use for saving notes, PoC scripts, recon output. User confirmation required.';
  }
  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Destination file path.' },
        content: { type: 'string', description: 'Full file content to write.' },
      },
      required: ['path', 'content'],
    };
  }
  requiresPermission(): boolean {
    return true;
  }
  summarize(args: Record<string, unknown>): { summary: string; detail: string } {
    const path = argString(args, 'path');
    const content = argString(args, 'content');
    const preview = content.length > 400 ? `${content.slice(0, 400)}...` : content;
    return {
      summary: `write file: ${path}`,
      detail: `path: ${path}\n--- content ---\n${preview}`,
    };
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, p: Prompter): Promise<string> {
    const path = argString(args, 'path');
    const content = argString(args, 'content');
    if (!path) throw new Error('path is required');
    const abs = resolve(path);
    await gateSensitive(p, abs, 'write to', signal);
    await mkdir(dirname(abs), { recursive: true, mode: 0o755 });
    await writeFile(abs, content, { encoding: 'utf8', mode: 0o644 });
    return `wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${abs}`;
  }
}

export class FileEditTool implements Tool {
  private readonly toolName: string;
  constructor(toolName = 'file_edit') {
    this.toolName = toolName;
  }
  name(): string {
    return this.toolName;
  }
  description(): string {
    return 'Replace an exact string in a file. old_string must appear exactly once unless replace_all=true. Use for patching scripts or notes without rewriting the whole file.';
  }
  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    };
  }
  requiresPermission(): boolean {
    return true;
  }
  summarize(args: Record<string, unknown>): { summary: string; detail: string } {
    const path = argString(args, 'path');
    return {
      summary: `edit file: ${path}`,
      detail: `path: ${path}\n- ${argString(args, 'old_string')}\n+ ${argString(args, 'new_string')}`,
    };
  }

  async run(args: Record<string, unknown>, signal: AbortSignal, p: Prompter): Promise<string> {
    const path = argString(args, 'path');
    const oldS = argString(args, 'old_string');
    const newS = argString(args, 'new_string');
    const replaceAll = argBool(args, 'replace_all');
    if (!path || !oldS) throw new Error('path and old_string are required');

    const abs = resolve(path);
    await gateSensitive(p, abs, 'edit', signal);
    const content = await readFile(abs, 'utf8');
    const count = countOccurrences(content, oldS);
    if (count === 0) throw new Error(`old_string not found in ${abs}`);
    if (count > 1 && !replaceAll) {
      throw new Error(
        `old_string appears ${count} times in ${abs}; pass replace_all=true or use a longer unique snippet`,
      );
    }
    const updated = replaceAll ? content.split(oldS).join(newS) : content.replace(oldS, newS);
    await writeFile(abs, updated, { encoding: 'utf8', mode: 0o644 });
    return `edited ${abs} (${count} replacement(s))`;
  }
}

/** PascalCase tool-name aliases. Same behavior, different tool name surface
 *  so prompts written for either convention work without translation. */
export class FileReadToolAlias extends FileReadTool {
  constructor() {
    super('FileReadTool');
  }
}
export class FileWriteToolAlias extends FileWriteTool {
  constructor() {
    super('FileWriteTool');
  }
}
export class FileEditToolAlias extends FileEditTool {
  constructor() {
    super('FileEditTool');
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx < 0) return count;
    count += 1;
    pos = idx + needle.length;
  }
}

// Re-exported so callers don't have to import node:path just to check.
export { isAbsolute };
