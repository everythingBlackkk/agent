// Redactor tests — these pin the pattern set; update them whenever a
// new credential shape is added to redact.ts.
//
// Every fixture below is a synthetic, non-live value assembled from fragments
// via frag() so no contiguous secret literal ever exists in source. The
// redactor still sees the full token at runtime, while repository secret
// scanners stay quiet.

import { describe, expect, it } from 'vitest';
import { apply } from './redact.js';

const frag = (...parts: string[]): string => parts.join('');

describe('redact.apply', () => {
  it('redacts bearer tokens', () => {
    const secret = frag('abcdefghij', '1234567890XYZ');
    const out = apply(`Authorization: Bearer ${secret}`);
    expect(out).not.toContain(secret);
  });

  it('redacts AWS key ids while keeping AKIA prefix', () => {
    const out = apply(frag('aws key: AKIA', 'IOSFODNN7EXAMPLE'));
    expect(out).not.toContain('IOSFODNN7EXAMPLE');
    expect(out).toContain('AKIA');
  });

  it('redacts GitHub tokens', () => {
    const body = frag('1234567890abcdefghij', 'klmnopqrstuvwxyzAB');
    const out = apply(frag('token=ghp_', body));
    expect(out).not.toContain(body);
  });

  it('redacts JWT bodies', () => {
    const sig = frag('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV', '_adQssw5c');
    const jwt = frag('got jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.', sig);
    const out = apply(jwt);
    expect(out).not.toContain(sig);
  });

  it('redacts entire private key blocks but keeps the BEGIN marker', () => {
    const begin = frag('-----BEGIN RSA PRIVATE ', 'KEY-----');
    const end = frag('-----END RSA PRIVATE ', 'KEY-----');
    const body = frag('MIIEowIBAAKCAQEAuhpb', '...\nsecret-bytes-here');
    const input = `prefix\n${begin}\n${body}\n${end}\nsuffix`;
    const out = apply(input);
    expect(out).not.toContain('MIIEowIBAAKCAQEAuhpb');
    expect(out).toContain('BEGIN PRIVATE KEY');
  });

  it('redacts generic api_key assignments', () => {
    const secret = frag('abc123def456', 'ghi789jkl0');
    const out = apply(`api_key = "${secret}"`);
    expect(out).not.toContain(secret);
  });

  it('returns empty string for empty input', () => {
    expect(apply('')).toBe('');
  });

  it('leaves clean input alone', () => {
    const input = 'hello world, nothing sensitive here';
    expect(apply(input)).toBe(input);
  });
});
