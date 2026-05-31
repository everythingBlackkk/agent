// Reducer tests focused on the recently-fixed display issues:
//   - tool-call arg JSON is collapsed to a single-line preview
//   - the preview is capped at 120 chars
//   - escaped \n / \t inside the JSON don't bleed through

import { describe, expect, it } from 'vitest';
import { initialState, reducer } from './state.js';

const seed = () => initialState('');

describe('state.reducer tool-call preview', () => {
  it('collapses escaped \\n in the args preview', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'shell',
        args: {},
        argsJSON: '{"command":"python3 -c \\"\\nports = [\\n  80,443\\n]\\""}',
      },
    });
    const last = out.transcript[out.transcript.length - 1];
    expect(last?.kind).toBe('tool-call');
    expect(last?.text).not.toContain('\n');
    expect(last?.text).not.toContain('\\n');
    expect(last?.text).toContain('Shell(');
    expect(last?.text).toContain('python3');
  });

  it('caps the preview at 120 chars after the tool name', () => {
    const longArgs = JSON.stringify({ command: 'echo '.repeat(500) });
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'shell',
        args: {},
        argsJSON: longArgs,
      },
    });
    const last = out.transcript[out.transcript.length - 1];
    // "shell " (6) + 120 + "…" (1) = 127 total. Loose check on the cap.
    expect(last?.text.length).toBeLessThanOrEqual(140);
    expect(last?.text).toMatch(/…$/);
  });

  it('shows the bare command, not the JSON envelope', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'shell',
        args: {},
        argsJSON: '{"command":"curl -ksS https://example.com"}',
      },
    });
    const last = out.transcript.at(-1);
    expect(last?.text).toBe('Shell(curl -ksS https://example.com)');
    expect(last?.prefix).toBe('⏺ ');
    expect(last?.text).not.toContain('{"command"');
  });

  it('renders BashTool calls in compact Bash(command) style', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'BashTool',
        args: {},
        argsJSON: '{"command":"mkdir -p recon/gobus.net"}',
      },
    });
    const last = out.transcript.at(-1);
    expect(last?.text).toBe('Bash(mkdir -p recon/gobus.net)');
    expect(last?.prefix).toBe('⏺ ');
  });

  it('renders commented shell commands as action title plus command', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'shell',
        args: {},
        argsJSON: JSON.stringify({
          command: [
            '# Check for Laravel debug mode - try to trigger an error',
            'curl -s "https://egyptianclothingbank.org/donor/login" -X POST',
          ].join('\n'),
        }),
      },
    });
    const last = out.transcript.at(-1);
    expect(last?.text).toBe(
      [
        'Shell · Check for Laravel debug mode',
        '$ curl -s "https://egyptianclothingbank.org/donor/login" -X POST',
      ].join('\n'),
    );
    expect(last?.prefix).toBe('⏺ ');
  });

  it('renders long uncommented Bash commands as a titled command block', () => {
    const command =
      'curl -fsS --max-time 30 -H \'Accept: application/json\' "https://crt.sh/?q=%25.egyptianclothingbank.org&output=json" 2>/dev/null';
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'BashTool',
        args: {},
        argsJSON: JSON.stringify({ command }),
      },
    });
    const last = out.transcript.at(-1);
    expect(last?.text).toBe(
      [
        'Bash · HTTP request',
        '$ curl -fsS --max-time 30 -H \'Accept: application/json\' "https://crt.sh/?q=%25.egyptianclothingbank.org&output=json" 2>/de…',
      ].join('\n'),
    );
    expect(last?.prefix).toBe('⏺ ');
  });

  it('strips raw control chars from the preview', () => {
    const args = '{"raw":"line1\nline2\tcol"}';
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-call',
        id: 'c1',
        name: 'shell',
        args: {},
        argsJSON: args,
      },
    });
    const last = out.transcript[out.transcript.length - 1];
    expect(last?.text).not.toContain('\n');
    expect(last?.text).not.toContain('\t');
    expect(last?.text).toContain('line1');
    expect(last?.text).toContain('line2');
  });
});

describe('state.reducer streaming / committed-live split', () => {
  const ev = (event: Parameters<typeof reducer>[1] extends { event: infer E } ? E : never) =>
    ({ type: 'agent-event', event }) as const;

  it('keeps a streaming assistant entry flagged until done finalizes it', () => {
    let s = reducer(seed(), ev({ type: 'assistant-delta', text: 'hel' }));
    s = reducer(s, ev({ type: 'assistant-delta', text: 'lo' }));
    const live = s.transcript.at(-1);
    expect(live?.kind).toBe('assistant');
    expect(live?.streaming).toBe(true);
    expect(live?.text).toBe('hello');

    // 'done' finalizes the tail streaming entry so it can join the log.
    s = reducer(s, ev({ type: 'done' }));
    expect(s.transcript.at(-1)?.streaming).toBe(false);
    expect(s.busy).toBe(false);
  });
});

describe('state.reducer clear', () => {
  it('empties the transcript and bumps clearGen to remount the log', () => {
    const withEntry = reducer(seed(), {
      type: 'append',
      entry: { kind: 'system', text: 'hi' },
    });
    const cleared = reducer(withEntry, { type: 'clear' });
    expect(cleared.transcript).toHaveLength(0);
    expect(cleared.clearGen).toBe(withEntry.clearGen + 1);
  });
});

describe('state.reducer tool-result body', () => {
  it('renders successful empty BashTool output as Done', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-result',
        id: 'c1',
        name: 'BashTool',
        result: 'exit: 0\nstdout:\n',
        err: '',
        durationMs: 12,
      },
    });
    const last = out.transcript.at(-1);
    expect(last?.kind).toBe('tool-result');
    expect(last?.text).toBe('Done');
    expect(last?.prefix).toBe('  ⎿ ');
  });

  it('keeps successful shell stdout compact', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-result',
        id: 'c1',
        name: 'shell',
        result: 'exit: 0\nstdout:\n101',
        err: '',
        durationMs: 12,
      },
    });
    const last = out.transcript[out.transcript.length - 1];
    expect(last?.text).toBe('[ok] shell (12ms)\n101');
  });
});

describe('state.reducer expandable tool-result', () => {
  const ESC = String.fromCharCode(0x1b);
  const strip = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

  // A browser-snapshot-shaped MCP result: long YAML inside a text block.
  const bigSnapshot = JSON.stringify([
    { type: 'text', text: Array.from({ length: 100 }, (_, i) => `  link "item ${i}"`).join('\n') },
  ]);

  const withResult = () =>
    reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-result',
        id: 'c1',
        name: 'mcp_browser_browser_navigate',
        result: bigSnapshot,
        err: '',
        durationMs: 8221,
      },
    });

  it('starts collapsed with an expand hint and no JSON envelope', () => {
    const last = withResult().transcript.at(-1);
    expect(last?.collapsible).toBe(true);
    expect(last?.expanded).toBeUndefined();
    expect(strip(last?.text ?? '')).toContain('Ctrl-O to expand');
    expect(strip(last?.text ?? '')).not.toContain('"type"');
    // Collapsed preview is far shorter than the retained full body.
    expect(last?.text.length).toBeLessThan((last?.fullText ?? '').length);
  });

  it('Ctrl-O reprints the full body as a new log entry and marks the source expanded', () => {
    const expanded = reducer(withResult(), { type: 'expand-tool-output' });
    // Source entry stays put (frozen in scrollback) but is now marked expanded.
    expect(expanded.transcript).toHaveLength(2);
    expect(expanded.transcript[0]?.expanded).toBe(true);
    // The appended entry holds the full body.
    const appended = expanded.transcript.at(-1);
    expect(appended?.kind).toBe('tool-result');
    expect(strip(appended?.text ?? '')).toContain('link "item 99"');

    // A second Ctrl-O is a no-op — the source is already expanded.
    const again = reducer(expanded, { type: 'expand-tool-output' });
    expect(again.transcript).toHaveLength(2);
  });

  it('expand is a no-op when nothing is collapsible', () => {
    const out = reducer(seed(), { type: 'expand-tool-output' });
    expect(out.transcript).toHaveLength(0);
  });

  it('short results are not collapsible', () => {
    const out = reducer(seed(), {
      type: 'agent-event',
      event: {
        type: 'tool-result',
        id: 'c2',
        name: 'file_read',
        result: 'small body\nthree lines\nonly',
        err: '',
        durationMs: 5,
      },
    });
    expect(out.transcript.at(-1)?.collapsible).toBeUndefined();
  });
});
