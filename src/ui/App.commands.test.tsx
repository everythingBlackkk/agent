// Integration tests for the UI-only slash commands that the headless
// command harness can't reach: /exit, /quit, /clear, /provider, /yolo.
// Mounts the real <App> with ink-testing-library and drives keystrokes.

import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../agent/agent.js';
import type { Client } from '../llm/client.js';
import type { ChatResponse } from '../llm/types.js';
import { AlwaysAllow } from '../permission/permission.js';
import { newRegistry } from '../skills/registry.js';
import { Target } from '../target/target.js';
import { Registry as ToolRegistry } from '../tools/registry.js';
import { App, type AppProps } from './App.js';
import type { BannerData } from './Banner.js';
import { TerminalSizeProvider } from './TerminalSize.js';

const stubClient: Client = {
  name: () => 'stub',
  model: () => 'stub-model',
  chat: async (): Promise<ChatResponse> => ({
    message: { role: 'assistant', content: '' },
    finishReason: 'stop',
  }),
};

const bannerData: BannerData = {
  provider: 'ollama',
  model: 'stub-model',
  state: 'local',
  cwd: '/tmp/engagement',
};

const tick = () => new Promise((r) => setTimeout(r, 50));

let agent: Agent;
let runSpy: ReturnType<typeof vi.fn>;
let setYolo: ReturnType<typeof vi.fn>;
let applyProvider: ReturnType<typeof vi.fn>;
let mounted: ReturnType<typeof render> | null = null;

function makeProps(): AppProps {
  return {
    agent,
    bannerData,
    parentSignal: new AbortController().signal,
    readConfig: () => ({ backend: 'ollama', baseURL: '', apiKey: '', model: 'stub-model' }),
    applyProvider,
    setYolo,
  };
}

/** Mount <App> wrapped in the providers the CLI gives it. */
function renderApp() {
  return render(
    <TerminalSizeProvider>
      <App {...makeProps()} />
    </TerminalSizeProvider>,
  );
}

/** Type a line and press Enter, letting React flush between writes. */
async function submit(stdin: { write: (s: string) => void }, line: string) {
  stdin.write(line);
  await tick();
  stdin.write('\r');
  await tick();
}

beforeEach(() => {
  const skills = newRegistry();
  skills.loadDir(join(process.cwd(), 'skills'));
  agent = new Agent({
    client: stubClient,
    tools: new ToolRegistry(),
    skills,
    prompter: new AlwaysAllow(),
    store: null,
    target: new Target(),
  });
  runSpy = vi.fn(async () => {});
  // Detect whether a submission was routed to the agent (a chat prompt)
  // or intercepted by the slash dispatcher (a command).
  agent.run = runSpy as unknown as Agent['run'];
  setYolo = vi.fn();
  applyProvider = vi.fn(async () => {});
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('UI slash commands (terminal integration)', () => {
  it('control: a normal message is routed to the agent', async () => {
    mounted = renderApp();
    await tick();
    await submit(mounted.stdin, 'find idors on the api');
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy.mock.calls[0][0]).toBe('find idors on the api');
  });

  it('/exit is handled as a command, not sent to the agent', async () => {
    mounted = renderApp();
    await tick();
    await submit(mounted.stdin, '/exit');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('/quit is handled as a command, not sent to the agent', async () => {
    mounted = renderApp();
    await tick();
    await submit(mounted.stdin, '/quit');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('/yolo on then off flips the gate and the status-bar pill', async () => {
    mounted = renderApp();
    await tick();

    await submit(mounted.stdin, '/yolo on');
    expect(setYolo).toHaveBeenLastCalledWith(true); // the real gate flips
    expect(mounted.lastFrame()).toContain('YOLO on'); // UI confirms

    await submit(mounted.stdin, '/yolo off');
    expect(setYolo).toHaveBeenLastCalledWith(false);
    expect(mounted.lastFrame()).toContain('YOLO off');

    expect(runSpy).not.toHaveBeenCalled();
  });

  it('/provider opens the backend picker', async () => {
    mounted = renderApp();
    await tick();
    await submit(mounted.stdin, '/provider');
    const frame = mounted.lastFrame() ?? '';
    expect(frame).toMatch(/backend|Ollama/i);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('/clear emits the clear-screen escape and is not sent to the agent', async () => {
    mounted = renderApp();
    await tick();
    await submit(mounted.stdin, '/clear');
    // clearScreen() writes \x1b[2J\x1b[3J\x1b[H to stdout.
    const allOutput = mounted.stdout.frames.join('');
    expect(allOutput).toContain('\x1b[2J');
    expect(runSpy).not.toHaveBeenCalled();
  });
});
