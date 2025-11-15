import { describe, expect, it } from 'vitest';
import { decodeBase64Url, normalizeMessageBody } from '../nlp';

const htmlContent = '<html><body><p>Hello</p><a href="https://example.com">Example</a></body></html>';
const textContent = 'Plain text fallback';

const htmlData = encodeBase64Url(htmlContent);
const textData = encodeBase64Url(textContent);

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('decodeBase64Url', () => {
  it('decodes base64url strings', () => {
    expect(decodeBase64Url(htmlData)).toBe(htmlContent);
  });
});

describe('normalizeMessageBody', () => {
  it('extracts html, text, and links', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: textData }
        },
        {
          mimeType: 'text/html',
          body: { data: htmlData }
        }
      ]
    };

    const normalized = normalizeMessageBody(payload);
    expect(normalized.html).toContain('<p>Hello</p>');
    expect(normalized.text).toBe('Plain text fallback');
    expect(normalized.links).toEqual(['https://example.com']);
  });

  it('falls back to stripping html when plain text is missing', () => {
    const payload = {
      mimeType: 'text/html',
      body: { data: htmlData }
    };

    const normalized = normalizeMessageBody(payload);
    expect(normalized.text).toBe('Hello Example');
  });
});
