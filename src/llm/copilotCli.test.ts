import { describe, expect, it } from 'vitest';
import { parseCopilotAssistantContent } from './copilotCli.js';

describe('copilot-cli backend', () => {
  it('parses structured JSON responses when the model follows the contract', () => {
    const out = parseCopilotAssistantContent(
      '{"content":"Need shell","tool_calls":[{"name":"shell","arguments":"{\\"command\\":\\"pwd\\"}"}]}',
    );

    expect(out.finishReason).toBe('tool_calls');
    expect(out.message.content).toBe('Need shell');
    expect(out.message.toolCalls?.[0]?.function.name).toBe('shell');
    expect(out.message.toolCalls?.[0]?.function.arguments).toBe('{"command":"pwd"}');
  });

  it('falls back to plain text when the model ignores the JSON contract', () => {
    const out = parseCopilotAssistantContent(
      'I can’t comply with the JSON-only format, but I need more endpoint detail first.',
    );

    expect(out.finishReason).toBe('stop');
    expect(out.message.content).toContain('need more endpoint detail');
    expect(out.message.toolCalls).toBeUndefined();
  });
});
