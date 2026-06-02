import { describe, expect, it } from 'vitest';
import { cliBackendFromKind, modelsForCliBackend, normalizeCliModel } from './cliModels.js';

describe('cliModels', () => {
  it('maps --cli values to backends', () => {
    expect(cliBackendFromKind('codex')).toBe('codex-cli');
    expect(cliBackendFromKind('gemini')).toBe('gemini-cli');
    expect(cliBackendFromKind('copilot')).toBe('copilot-cli');
  });

  it('normalizes friendly copilot model labels', () => {
    expect(normalizeCliModel('copilot-cli', 'GPT-5 mini')).toBe('gpt-5-mini');
    expect(normalizeCliModel('copilot-cli', 'Claude Haiku 4.5')).toBe('claude-haiku-4.5');
  });

  it('returns the default model when empty', () => {
    expect(normalizeCliModel('codex-cli', '')).toBe('gpt-5.4-mini');
    expect(normalizeCliModel('gemini-cli', '')).toBe('gemini-3-flash-preview');
  });

  it('returns fixed model catalogs', () => {
    expect(modelsForCliBackend('copilot-cli')).toContain('gpt-5.2-codex');
    expect(modelsForCliBackend('gemini-cli')).toContain('gemini-3.1-pro-preview');
  });
});
