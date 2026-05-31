// BridgedPrompter session-cache behavior. An "allow session" decision is
// cached per tool so later calls skip the modal — EXCEPT requests flagged
// noSessionCache (arbitrary-exec / sensitive ops), which must re-prompt.

import { describe, expect, it } from 'vitest';
import type { Request } from '../permission/permission.js';
import { BridgedPrompter, type PermissionRequest } from './permBridge.js';

/** Drives the bridge by auto-resolving each published request with a fixed
 *  decision and counting how many modals were shown. */
function makeBridge(decision: 'allow-session' | 'allow-once') {
  let shown = 0;
  let pending: PermissionRequest | null = null;
  const bridge = new BridgedPrompter((req) => {
    if (req) {
      shown += 1;
      pending = req;
    }
  });
  const ask = async (req: Request) => {
    const promise = bridge.ask(req);
    if (pending) {
      const p = pending;
      pending = null;
      p.resolve(decision);
    }
    return promise;
  };
  return { ask, modals: () => shown };
}

describe('BridgedPrompter', () => {
  it('caches allow-session per tool so later calls skip the modal', async () => {
    const { ask, modals } = makeBridge('allow-session');
    const req: Request = { tool: 'http', summary: 's', detail: 'd' };
    await ask(req);
    await ask(req);
    expect(modals()).toBe(1); // second call served from cache
  });

  it('never caches when noSessionCache is set (re-prompts every call)', async () => {
    const { ask, modals } = makeBridge('allow-session');
    const req: Request = { tool: 'shell', summary: 's', detail: 'd', noSessionCache: true };
    await ask(req);
    await ask(req);
    expect(modals()).toBe(2); // re-prompted both times
  });
});
