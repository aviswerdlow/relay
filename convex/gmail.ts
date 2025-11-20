import type { EmailMetadata, NewsletterPlatform } from '@relay/types';

const PLATFORM_KEYWORDS: Record<Exclude<NewsletterPlatform, 'unknown'>, RegExp[]> = {
  substack: [
    /substack\.com/i,
    /\.substackmail\.com/i,
    /\.substack\.com/i
  ],
  beehiiv: [
    /beehiiv\.com/i,
    /\.beehiiv\.com/i
  ],
  buttondown: [
    /buttondown\.email/i,
    /\.buttondown\.email/i,
    /buttondown\.com/i
  ]
};

const BODY_CONFIRMATIONS: Record<Exclude<NewsletterPlatform, 'unknown'>, RegExp[]> = {
  substack: [/Powered by Substack/i, /view this email in your browser/i],
  beehiiv: [/beehiiv/i, /view newsletter in your browser/i],
  buttondown: [/Buttondown/i, /unsubscribe from this list/i]
};

export function buildNewsletterQuery(timeWindowDays: number): string {
  const boundedDays = Math.max(1, Math.min(365, Math.floor(timeWindowDays)));
  // Keep scope narrow but do not require links to maximize coverage.
  const senderFilters = ['substack.com', 'substackmail.com', 'beehiiv.com', 'buttondown.email']
    .map((domain) => `from:${domain}`)
    .join(' OR ');
  return [
    `newer_than:${boundedDays}d`,
    'has:link',
    'category:updates',
    '-is:chat',
    `(${senderFilters})`
  ].join(' ');
}

export function classifyNewsletterFromMetadata(metadata: Pick<EmailMetadata, 'from' | 'listId' | 'subject'>): NewsletterPlatform {
  const fromDomain = extractDomain(metadata.from);
  const listDomain = extractListDomain(metadata.listId ?? undefined);
  const haystack = [fromDomain, listDomain, metadata.subject ?? ''].filter(Boolean).join(' ');

  for (const [platform, patterns] of Object.entries(PLATFORM_KEYWORDS)) {
    if (patterns.some((pattern) => pattern.test(haystack))) {
      return platform as NewsletterPlatform;
    }
  }

  return 'unknown';
}

export function refinePlatformWithBody(body: string | null, initial: NewsletterPlatform): NewsletterPlatform {
  if (!body || initial !== 'unknown') {
    return initial;
  }

  for (const [platform, patterns] of Object.entries(BODY_CONFIRMATIONS)) {
    if (patterns.some((pattern) => pattern.test(body))) {
      return platform as NewsletterPlatform;
    }
  }

  return initial;
}

function extractDomain(from: string): string | null {
  const match = from.match(/<([^>]+)>/);
  const address = match ? match[1] : from;
  const domain = address.split('@')[1];
  return domain ? domain.trim().toLowerCase() : null;
}

function extractListDomain(listId?: string): string | null {
  if (!listId) return null;
  const match = listId.match(/<([^>]+)>/);
  const value = match ? match[1] : listId;
  const parts = value.split('@');
  return parts.length > 1 ? parts[1].toLowerCase() : value.toLowerCase();
}
