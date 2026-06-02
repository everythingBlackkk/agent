import { spawn, spawnSync } from 'node:child_process';
import { newCallID } from './ids.js';
import type { ChatRequest, ChatResponse, Message, ToolCall } from './types.js';

const MAX_CAPTURE_BYTES = 1024 * 1024;
const ANSI_PATTERN_SOURCE = String.raw`\u001B(?:[@-Z\\-_]|\[[0-?]*[ -\/]*[@-~])`;
const ANSI_PATTERN = new RegExp(ANSI_PATTERN_SOURCE, 'g');

interface CliEnvelope {
  content?: unknown;
  tool_calls?: unknown;
}

interface CliToolCall {
  name?: unknown;
  arguments?: unknown;
}

export function assertCliBinaryAvailable(
  command: string,
  notFoundMessage: string,
  probeArgs = ['--help'],
  label = 'cli preflight',
): void {
  const result = spawnSync(command, probeArgs, { encoding: 'utf8' });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    throw new Error(notFoundMessage);
  }
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`);
  }
}

export function buildCliBackendPrompt(req: ChatRequest): string {
  const toolCatalog = (req.tools ?? []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
  const transcript = req.messages.map((message) => ({
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    })),
    tool_call_id: message.toolCallID,
    name: message.name,
  }));

  return [
    'You are acting strictly as a model backend inside PentesterFlow.',
    'Return only the next assistant response for PentesterFlow as a single JSON object.',
    'The JSON object must have this shape: {"content":"string","tool_calls":[{"name":"tool_name","arguments":"{\\"key\\":\\"value\\"}"}]}.',
    'Do not run shell commands.',
    'Do not modify files.',
    'Do not browse the web.',
    'Do not attack targets independently.',
    'Do not execute any tool yourself.',
    'If a tool is needed, describe it in `tool_calls` only.',
    'Each tool call `arguments` field must be a JSON string encoding the arguments object.',
    'If no tool is needed, return an empty `tool_calls` array.',
    'Do not wrap the JSON in markdown fences.',
    '',
    'Available tools:',
    JSON.stringify(toolCatalog, null, 2),
    '',
    'Conversation:',
    JSON.stringify(transcript, null, 2),
  ].join('\n');
}

export function parseCliBackendResponse(raw: string, backend: string): ChatResponse {
  const parsed = parseLooseJson(raw) as CliEnvelope | undefined;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${backend} returned invalid JSON content`);
  }

  const content = typeof parsed.content === 'string' ? parsed.content : '';
  const calls = normalizeToolCalls(parsed.tool_calls);
  const message: Message = { role: 'assistant', content };
  if (calls.length > 0) message.toolCalls = calls;
  return {
    message,
    finishReason: calls.length > 0 ? 'tool_calls' : 'stop',
  };
}

export interface RunCliProcessOpts {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
  signal?: AbortSignal;
  notFoundMessage: string;
  errorLabel: string;
}

export async function runCliProcess(
  opts: RunCliProcessOpts,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, opts.timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const onAbort = () => {
      child.kill('SIGTERM');
      finish(() => reject(new Error(`${opts.errorLabel} request aborted`)));
    };

    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      const errno = err as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        finish(() => reject(new Error(opts.notFoundMessage)));
        return;
      }
      finish(() => reject(err));
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk;
    });

    child.on('close', (code) => {
      if (timedOut) {
        finish(() => reject(new Error(`${opts.errorLabel} timed out after ${opts.timeoutMs}ms`)));
        return;
      }
      const cleanStdout = stripAnsi(stdout).trim();
      const cleanStderr = stripAnsi(stderr).trim();
      if (code !== 0) {
        const detail =
          summarizeCliError(cleanStderr) ||
          summarizeCliError(cleanStdout) ||
          cleanStderr ||
          cleanStdout ||
          `exit code ${code ?? 'unknown'}`;
        finish(() => reject(new Error(`${opts.errorLabel} exited non-zero: ${detail}`)));
        return;
      }
      finish(() => resolve({ stdout: cleanStdout, stderr: cleanStderr }));
    });

    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

export function parseLooseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced?.[1]?.trim() ?? sliceFirstJsonValue(trimmed);
    if (!candidate) return undefined;
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const out: ToolCall[] = [];
  for (const item of value) {
    const call = item as CliToolCall;
    if (typeof call?.name !== 'string' || !call.name) continue;
    const args =
      typeof call.arguments === 'string'
        ? call.arguments
        : JSON.stringify(
            call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
              ? call.arguments
              : {},
          );
    out.push({
      id: newCallID(),
      type: 'function',
      function: { name: call.name, arguments: args },
    });
  }
  return out;
}

function sliceFirstJsonValue(input: string): string | undefined {
  const start = input.search(/[\[{]/);
  if (start < 0) return undefined;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') stack.push('}');
    if (ch === '[') stack.push(']');
    if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return undefined;
      if (stack.length === 0) return input.slice(start, i + 1);
    }
  }
  return undefined;
}

function summarizeCliError(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ERROR:')) {
      const body = trimmed.slice('ERROR:'.length).trim();
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string } };
        if (parsed.error?.message) return parsed.error.message;
      } catch {
        if (body) return body;
      }
    }
    if (trimmed.startsWith('Error: ')) return trimmed.slice('Error: '.length);
  }
  return undefined;
}
