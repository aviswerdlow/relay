'use node';

import crypto from 'node:crypto';

export function deriveAesKey(secret: string): Buffer {
  const normalized = secret.trim();
  let key: Buffer | null = null;

  if (/^[0-9a-fA-F]+$/.test(normalized) && normalized.length === 64) {
    key = Buffer.from(normalized, 'hex');
  } else {
    const bytes = Buffer.from(normalized, normalized.includes('=') ? 'base64' : 'utf8');
    if (bytes.length === 32) {
      key = bytes;
    } else if (bytes.length > 32) {
      key = crypto.createHash('sha256').update(bytes).digest();
    } else {
      throw new Error('Encryption secret must be at least 32 bytes when decoded.');
    }
  }

  if (key.length !== 32) {
    key = crypto.createHash('sha256').update(key).digest();
  }

  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), encrypted.toString('base64'), authTag.toString('base64')].join('.');
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  const [ivB64, dataB64, tagB64] = ciphertext.split('.');
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error('Invalid encrypted payload format.');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const encryptedData = Buffer.from(dataB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted.toString('utf8');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashTokenNode(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
