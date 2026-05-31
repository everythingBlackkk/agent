// Backend error-classification tests.

import { describe, expect, it } from 'vitest';
import { BackendError, classifyBackend } from './errors.js';

describe('classifyBackend', () => {
  it('tags ECONNREFUSED as backend-down', () => {
    const err = new Error('fetch failed: connect ECONNREFUSED 127.0.0.1:11434');
    const out = classifyBackend('ollama', err, 0, undefined);
    expect(out).toBeInstanceOf(BackendError);
    expect(out.category).toBe('backend-down');
  });

  it('tags ENOTFOUND as backend-down', () => {
    const err = new Error('getaddrinfo ENOTFOUND missing.host');
    const out = classifyBackend('openai-compat', err, 0, undefined);
    expect(out.category).toBe('backend-down');
  });

  it('tags ollama "model not found" body as model-not-found', () => {
    const body = JSON.stringify({ error: 'model qwen2.5:7b not found, try pulling it first' });
    const out = classifyBackend('ollama', null, 404, body);
    expect(out.category).toBe('model-not-found');
    expect(out.statusCode).toBe(404);
  });

  it('tags lmstudio "no model loaded" body as model-not-loaded', () => {
    const body = JSON.stringify({
      error: { message: 'No models loaded; please load a model in the UI' },
    });
    const out = classifyBackend('lmstudio', null, 400, body);
    expect(out.category).toBe('model-not-loaded');
  });

  it('leaves unrecognized errors as unknown', () => {
    const out = classifyBackend('ollama', null, 500, 'internal server error');
    expect(out.category).toBe('unknown');
    expect(out.message).toContain('500');
  });

  it('falls back to raw body when not JSON', () => {
    const out = classifyBackend('ollama', null, 500, 'plain text');
    expect(out.detail).toBe('plain text');
  });

  it('extracts message from OpenAI envelope', () => {
    const body = JSON.stringify({ error: { message: 'invalid api key' } });
    const out = classifyBackend('openai-compat', null, 401, body);
    expect(out.detail).toBe('invalid api key');
  });
});
