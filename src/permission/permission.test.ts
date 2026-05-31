// Permission-flag behavior: YOLO must not auto-approve `bypassYolo`
// requests, and `noSessionCache` requests must not be whitelisted for the
// session by an "allow session" decision.

import { describe, expect, it } from 'vitest';
import type { Decision, Prompter, Request } from './permission.js';
import { YoloPrompter } from './permission.js';

/** Records every request and answers with a scripted decision. */
class ScriptedPrompter implements Prompter {
  readonly seen: Request[] = [];
  constructor(private readonly decision: Decision) {}
  async ask(req: Request): Promise<Decision> {
    this.seen.push(req);
    return this.decision;
  }
}

describe('YoloPrompter', () => {
  it('auto-approves ordinary requests without prompting', async () => {
    const inner = new ScriptedPrompter('deny');
    const y = new YoloPrompter(inner, true);
    expect(await y.ask({ tool: 'shell', summary: 's', detail: 'd' })).toBe('allow-once');
    expect(inner.seen).toHaveLength(0);
  });

  it('defers bypassYolo requests to the real prompter even in YOLO', async () => {
    const inner = new ScriptedPrompter('deny');
    const y = new YoloPrompter(inner, true);
    const decision = await y.ask({
      tool: 'file',
      summary: 's',
      detail: 'd',
      bypassYolo: true,
    });
    expect(decision).toBe('deny');
    expect(inner.seen).toHaveLength(1);
  });
});
