import { describe, expect, it } from 'vitest';
import { cliBackendFromKind, modelsForCliBackend, normalizeCliModel } from './cliModels.js';

describe('cliModels', () => {
  it('maps --cli values to backends', () => {
    expect(cliBackendFromKind('codex')).toBe('codex-cli');
    expect(cliBackendFromKind('gemini')).toBe('gemini-cli');
  });

  it('returns the default model when empty', () => {
    expect(normalizeCliModel('codex-cli', '')).toBe('gpt-5.4-mini');
    expect(normalizeCliModel('gemini-cli', '')).toBe('gemini-3-flash-preview');
  });

  it('returns fixed model catalogs', () => {
    expect(modelsForCliBackend('gemini-cli')).toContain('gemini-3.1-pro-preview');
  });
});
