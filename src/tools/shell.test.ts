// Shell denylist + execution tests.

import { describe, expect, it } from 'vitest';
import { AlwaysAllow } from '../permission/permission.js';
import { BashTool, DENY_PATTERNS, ShellTool } from './shell.js';

describe('shell denylist', () => {
  const cases: Array<{ name: string; cmd: string; shouldBlock: boolean }> = [
    { name: 'rm -rf /', cmd: 'rm -rf /', shouldBlock: true },
    { name: 'rm -fr / (flag order)', cmd: 'rm -fr /', shouldBlock: true },
    { name: 'rm --recursive --force /', cmd: 'rm --recursive --force /', shouldBlock: true },
    { name: 'rm -rf /*', cmd: 'rm -rf /*', shouldBlock: true },
    { name: 'rm -rf /home (top-level)', cmd: 'rm -rf /home', shouldBlock: true },
    { name: 'rm -rf /home/user (no trailing root)', cmd: 'rm -rf /home/user', shouldBlock: false },
    { name: 'rm -rf ./build (relative)', cmd: 'rm -rf ./build', shouldBlock: false },
    { name: 'find / -delete', cmd: 'find / -delete', shouldBlock: true },
    { name: 'find . -exec rm', cmd: 'find . -name x -exec rm {} ;', shouldBlock: true },
    { name: 'poweroff', cmd: 'poweroff', shouldBlock: true },
    { name: 'fork bomb', cmd: ':(){ :|:& };:', shouldBlock: true },
    { name: 'mkfs', cmd: 'mkfs.ext4 /dev/sda1', shouldBlock: true },
    { name: 'dd to /dev disk', cmd: 'dd if=/dev/zero of=/dev/sda', shouldBlock: true },
    { name: 'redirect to /dev/sda', cmd: 'cat file > /dev/sda', shouldBlock: true },
    { name: 'shutdown', cmd: 'shutdown -h now', shouldBlock: true },
    { name: 'reboot', cmd: 'reboot', shouldBlock: true },
    { name: 'normal curl', cmd: 'curl -s https://example.com', shouldBlock: false },
    { name: 'normal ls', cmd: 'ls -la /tmp', shouldBlock: false },
    { name: 'jq pipeline', cmd: 'curl -s url | jq .', shouldBlock: false },
  ];

  for (const tc of cases) {
    it(`${tc.name} → ${tc.shouldBlock ? 'block' : 'allow'}`, () => {
      const blocked = DENY_PATTERNS.some((re) => re.test(tc.cmd));
      expect(blocked).toBe(tc.shouldBlock);
    });
  }
});

describe('ShellTool.run', () => {
  it('executes a benign command and returns stdout', async () => {
    const t = new ShellTool();
    const out = await t.run(
      { command: 'echo hello && echo world' },
      new AbortController().signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('exit: 0');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('rejects a blocked command before spawn', async () => {
    const t = new ShellTool();
    await expect(
      t.run({ command: 'rm -rf /' }, new AbortController().signal, new AlwaysAllow()),
    ).rejects.toThrow(/blocked by denylist/);
  });

  it('errors when command is missing', async () => {
    const t = new ShellTool();
    await expect(t.run({}, new AbortController().signal, new AlwaysAllow())).rejects.toThrow(
      /command is required/,
    );
  });

  it('captures stderr alongside stdout', async () => {
    const t = new ShellTool();
    const out = await t.run(
      { command: 'echo stdout-line; echo stderr-line >&2; exit 3' },
      new AbortController().signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('stdout-line');
    expect(out).toContain('stderr-line');
    expect(out).toContain('exit: 3');
  });
});

describe('ShellTool output cap', () => {
  it('bounds retained output to ~MAX_OUTPUT_BYTES even for huge streams', async () => {
    const t = new ShellTool();
    // Emit ~1MB; the model should only ever see the 32KB head + truncation
    // marker, and the process must not buffer the whole thing.
    const out = await t.run(
      { command: 'head -c 1000000 /dev/zero | tr "\\0" "a"' },
      new AbortController().signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('truncated');
    expect(out.length).toBeLessThan(64 * 1024);
  });

  it('never caches an allow-session grant (re-prompts every call)', () => {
    const t = new ShellTool();
    expect(t.permissionHints().noSessionCache).toBe(true);
  });
});

describe('BashTool', () => {
  it('runs bash-only constructs', async () => {
    const t = new BashTool();
    const out = await t.run(
      { command: '[[ -d /tmp ]] && echo bash-ok' },
      new AbortController().signal,
      new AlwaysAllow(),
    );
    expect(out).toContain('bash-ok');
  });
});
