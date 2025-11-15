import { describe, expect, it, vi } from 'vitest';
import { assertRequiredScopes, isExpired, parseScopes, sanitizeRetentionDays, sanitizeTimeWindowDays } from '../util';
import { decryptSecret, deriveAesKey, encryptSecret } from '../crypto';

describe('encryption helpers', () => {
  const secret = 'super-secret-key-that-is-long-enough';
  const key = deriveAesKey(secret);

  it('round-trips plaintext with AES-GCM', () => {
    const plaintext = 'hello-world';
    const encrypted = encryptSecret(plaintext, key);
    expect(encrypted).not.toEqual(plaintext);

    const decrypted = decryptSecret(encrypted, key);
    expect(decrypted).toEqual(plaintext);
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptSecret('malformed', key)).toThrow();
  });
});

describe('scope helpers', () => {
  it('flattens scope strings', () => {
    expect(parseScopes('email profile')).toEqual(['email', 'profile']);
    expect(parseScopes(['email profile', 'openid'])).toEqual(['email', 'profile', 'openid']);
  });

  it('detects missing scopes', () => {
    expect(() => assertRequiredScopes(['email'], ['email', 'profile'])).toThrow();
    expect(() => assertRequiredScopes(['email', 'profile'], ['email'])).not.toThrow();
  });
});

describe('retention helpers', () => {
  it('clamps time window and retention days', () => {
    expect(sanitizeTimeWindowDays(2)).toBe(7);
    expect(sanitizeTimeWindowDays(400)).toBe(365);
    expect(sanitizeRetentionDays(15)).toBe(15);
    expect(sanitizeRetentionDays(999)).toBe(365);
  });

  it('detects expired bodies using fake timers', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(isExpired(now.valueOf() - 1000)).toBe(true);
    expect(isExpired(now.valueOf() + 1000)).toBe(false);
    vi.useRealTimers();
  });
});
