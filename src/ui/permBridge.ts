// Bridges the agent's Prompter interface (called from a non-React
// goroutine-equivalent) to React state managed by the TUI. A pending
// request lives in app state until the user picks y/a/n; the agent's
// promise resolves when that happens.

import type { Decision, Prompter, Request } from '../permission/permission.js';

export interface PermissionRequest extends Request {
  resolve: (d: Decision) => void;
  reject: (err: Error) => void;
}

export type PermissionPublisher = (req: PermissionRequest | null) => void;

export class BridgedPrompter implements Prompter {
  private publish: PermissionPublisher;
  private sessionAllowed = new Set<string>();

  constructor(publish: PermissionPublisher) {
    this.publish = publish;
  }

  async ask(req: Request, signal?: AbortSignal): Promise<Decision> {
    if (this.sessionAllowed.has(req.tool)) return 'allow-once';
    return new Promise<Decision>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      const onAbort = () => {
        this.publish(null);
        reject(new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const wrapped: PermissionRequest = {
        ...req,
        resolve: (d: Decision) => {
          signal?.removeEventListener('abort', onAbort);
          // Arbitrary-exec / sensitive requests opt out of session caching:
          // honor this one approval but re-prompt next time so a single
          // "allow session" can't silently whitelist every later command.
          if (d === 'allow-session' && !req.noSessionCache) this.sessionAllowed.add(req.tool);
          this.publish(null);
          resolve(d);
        },
        reject: (err: Error) => {
          signal?.removeEventListener('abort', onAbort);
          this.publish(null);
          reject(err);
        },
      };
      this.publish(wrapped);
    });
  }
}
