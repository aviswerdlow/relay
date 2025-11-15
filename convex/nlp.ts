import type { EmailBody } from '@relay/types';

export interface NormalizedMessage {
  html: string | null;
  text: string | null;
  links: string[];
}

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
}

export function normalizeMessageBody(payload: GmailPayloadPart): NormalizedMessage {
  const htmlPart = findPart(payload, (part) => (part.mimeType?.toLowerCase() ?? '').startsWith('text/html'));
  const textPart = findPart(payload, (part) => (part.mimeType?.toLowerCase() ?? '').startsWith('text/plain'));

  const html = htmlPart?.body?.data ? decodeBase64Url(htmlPart.body.data).trim() : null;
  let text = textPart?.body?.data ? decodeBase64Url(textPart.body.data).trim() : null;

  if (!text && html) {
    text = stripHtml(html);
  }

  const links = html ? extractLinks(html) : [];

  return {
    html: html && html.length > 0 ? html : null,
    text: text && text.length > 0 ? text : null,
    links
  };
}

export function attachNormalizationMetadata(
  emailId: string,
  runId: string,
  normalized: NormalizedMessage,
  retentionExpiry: number
): EmailBody {
  return {
    emailId,
    runId,
    normalizedHtml: normalized.html,
    normalizedText: normalized.text,
    links: normalized.links,
    normalizedAt: Date.now(),
    retentionExpiry
  };
}

export function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  const bufferCtor = (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer;
  if (!bufferCtor) {
    throw new Error('Buffer is not available for base64 decoding.');
  }
  return bufferCtor.from(padded, 'base64').toString('utf8');
}

function findPart(part: GmailPayloadPart, predicate: (part: GmailPayloadPart) => boolean): GmailPayloadPart | null {
  if (predicate(part)) {
    return part;
  }

  if (part.parts) {
    for (const child of part.parts) {
      const match = findPart(child, predicate);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function extractLinks(html: string): string[] {
  const anchorPattern = /href\s*=\s*["']([^"']+)["']/gi;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const raw = match[1].trim();
    if (raw.startsWith('mailto:')) continue;
    found.add(raw);
  }
  return Array.from(found);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
