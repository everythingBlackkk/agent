import { describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../config/config.js';
import { newFromConfig } from './factory.js';

vi.mock('./copilotCli.js', async () => {
  const actual = await vi.importActual<typeof import('./copilotCli.js')>('./copilotCli.js');
  return {
    ...actual,
    assertCopilotCliAvailable: vi.fn(),
  };
});

vi.mock('./codexCli.js', async () => {
  const actual = await vi.importActual<typeof import('./codexCli.js')>('./codexCli.js');
  return {
    ...actual,
    assertCodexCliAvailable: vi.fn(),
  };
});

vi.mock('./geminiCli.js', async () => {
  const actual = await vi.importActual<typeof import('./geminiCli.js')>('./geminiCli.js');
  return {
    ...actual,
    assertGeminiCliAvailable: vi.fn(),
  };
});

describe('newFromConfig', () => {
  it('accepts codex-cli as a backend', async () => {
    const cfg = defaultConfig();
    cfg.backend = 'codex-cli';
    cfg.model = 'gpt-5.4-mini';

    const client = newFromConfig(cfg);

    expect(client.name()).toBe('codex-cli');
    expect(client.model()).toBe('gpt-5.4-mini');

    const mod = await import('./codexCli.js');
    expect(vi.mocked(mod.assertCodexCliAvailable)).toHaveBeenCalledWith('codex');
  });

  it('rejects unsupported codex-cli models', () => {
    const cfg = defaultConfig();
    cfg.backend = 'codex-cli';
    cfg.model = 'gpt-5.3-codex';

    expect(() => newFromConfig(cfg)).toThrow(/only supports model gpt-5.4-mini/);
  });

  it('accepts gemini-cli as a backend', async () => {
    const cfg = defaultConfig();
    cfg.backend = 'gemini-cli';
    cfg.model = 'gemini-3-flash-preview';

    const client = newFromConfig(cfg);

    expect(client.name()).toBe('gemini-cli');
    expect(client.model()).toBe('gemini-3-flash-preview');

    const mod = await import('./geminiCli.js');
    expect(vi.mocked(mod.assertGeminiCliAvailable)).toHaveBeenCalledWith('gemini');
  });

  it('accepts copilot-cli as a backend', async () => {
    const cfg = defaultConfig();
    cfg.backend = 'copilot-cli';
    cfg.model = 'gpt-5.2';

    const client = newFromConfig(cfg);

    expect(client.name()).toBe('copilot-cli');
    expect(client.model()).toBe('gpt-5.2');

    const mod = await import('./copilotCli.js');
    expect(vi.mocked(mod.assertCopilotCliAvailable)).toHaveBeenCalledWith('copilot');
  });
});
