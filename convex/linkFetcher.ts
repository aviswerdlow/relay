'use node';

import type { LinkMetadata } from '@relay/types';

export interface FetchLinkMetadataOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_BYTES = 256 * 1024;

export async function fetchLinkMetadata(url: string, options: FetchLinkMetadataOptions = {}): Promise<LinkMetadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`Link fetch failed (${response.status})`);
    }

    const buffer = await readLimited(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    const html = buffer.toString('utf8');

    return {
      url,
      fetchedAt: Date.now(),
      title: extractTitle(html),
      description: extractDescription(html),
      canonicalUrl: extractCanonicalUrl(html),
      socialLinks: extractSocialLinks(html)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = (response.body as any)?.getReader?.();
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer.slice(0, maxBytes));
  }
  let received = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.length;
    if (received > maxBytes) {
      chunks.push(value.slice(0, maxBytes - (received - value.length)));
      break;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? sanitize(match[1]) : null;
}

function extractDescription(html: string): string | null {
  const meta = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i);
  return meta ? sanitize(meta[1]) : null;
}

function extractCanonicalUrl(html: string): string | null {
  const match = html.match(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return match ? match[1].trim() : null;
}

function extractSocialLinks(html: string): string[] {
  const socialDomains = ['twitter.com', 'x.com', 'linkedin.com', 'instagram.com', 'tiktok.com'];
  const regex = /href\s*=\s*["']([^"']+)["']/gi;
  const links = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1].trim();
    try {
      const parsed = new URL(href, 'https://example.com');
      if (socialDomains.some((domain) => parsed.host.includes(domain))) {
        links.add(parsed.href);
      }
    } catch {
      continue;
    }
  }

  return Array.from(links);
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
