'use node';

import { action } from './_generated/server';
import { v } from 'convex/values';
import { defaultUserSettings, internalGetTokensForUser, internalGetUser } from './auth';
import {
  internalCompleteRun,
  internalCreateRun,
  internalMarkRunFailed,
  internalStoreEmailBody,
  internalStoreEmailMetadata,
  internalUpdateRunProgress,
  internalUpdateRunTotals
} from './scan';
import { deriveAesKey, decryptSecret } from './crypto';
import { buildNewsletterQuery, classifyNewsletterFromMetadata, refinePlatformWithBody } from './gmail';
import { normalizeMessageBody } from './nlp';
import { assertRequiredScopes, getRequiredEnvVar } from './util';
import { extractCompaniesSchema } from './extractionSchema';
import { fetchLinkMetadata } from './linkFetcher';
import { domainFromUrl, internalUpsertCompany, internalUpsertLinkMetadata } from './companies';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_MESSAGES = 200;
const MAX_LINK_SNAPSHOTS = 2;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini-2024-07-18';
const SYSTEM_PROMPT =
  'You extract mentions of NEW CONSUMER COMPANIES from newsletter text and optional landing pages. Do not invent companies. Exclude sponsored or public companies. Always include 1-2 evidence snippets.';
const LINK_BLOCKLIST = ['substack.com', 'substackmail.com', 'beehiiv.com', 'buttondown.email', 'gmail.com'];

export const startScan = action({
  args: {
    userId: v.string(),
    timeWindowDays: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(internalGetUser as any, { userId: args.userId })) as {
      _id: { toString(): string };
      settings: { timeWindowDays: number; retentionDays: number };
    } | null;
    if (!user) {
      throw new Error('User not found for scan');
    }

    const settings = user.settings ?? defaultUserSettings();
    const userId = user._id.toString();
    const timeWindowDays = args.timeWindowDays ?? settings.timeWindowDays ?? 90;
    const encryptionKey = deriveAesKey(getRequiredEnvVar('TOKEN_ENCRYPTION_SECRET'));

    const tokens = await ctx.runQuery(internalGetTokensForUser as any, { userId });
    if (!tokens) {
      throw new Error('No Google OAuth tokens available for user');
    }

    assertRequiredScopes(tokens.scopes ?? [], ['https://www.googleapis.com/auth/gmail.readonly']);

    const accessToken = decryptSecret(tokens.accessTokenEnc, encryptionKey);
    const refreshToken = decryptSecret(tokens.refreshTokenEnc, encryptionKey);
    void refreshToken; // future enhancement

    const query = buildNewsletterQuery(timeWindowDays);
    const runResponse = await ctx.runMutation(internalCreateRun as any, { userId, timeWindowDays });
    const runId = runResponse.runId;

    try {
      const messages = await listNewsletterCandidates(accessToken, query);
      await ctx.runMutation(internalUpdateRunTotals as any, { runId, totalMessages: messages.length });

      const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
      const retentionExpiry = Date.now() + retentionMs;

      let processed = 0;
      let classified = 0;
      let companiesFound = 0;

      for (const message of messages) {
        processed += 1;

        const meta = await fetchMessageMetadata(accessToken, message.id);
        const platformGuess = classifyNewsletterFromMetadata({
          from: meta.from,
          listId: meta.listId ?? undefined,
          subject: meta.subject ?? undefined
        });

        if (platformGuess === 'unknown') {
          await ctx.runMutation(internalUpdateRunProgress as any, {
            runId,
            processedMessages: processed,
            newslettersClassified: classified,
            processedCompanies: companiesFound
          });
          continue;
        }

        const fullMessage = await fetchFullMessage(accessToken, message.id);
        const normalized = normalizeMessageBody(fullMessage.payload);
        const platform = refinePlatformWithBody(normalized.html ?? normalized.text ?? null, platformGuess);

        const metaWithPlatform = { ...meta, platform };

        const { emailId } = await ctx.runMutation(internalStoreEmailMetadata as any, {
          runId,
          gmailId: message.id,
          threadId: message.threadId,
          subject: meta.subject ?? '',
          from: meta.from,
          listId: meta.listId ?? undefined,
          platform,
          sentAt: meta.sentAt
        });

        await ctx.runMutation(internalStoreEmailBody as any, {
          runId,
          emailId,
          normalizedHtml: normalized.html ?? undefined,
          normalizedText: normalized.text ?? undefined,
          links: normalized.links,
          retentionExpiry
        });

        const createdCount = await extractCompaniesForEmail(ctx, {
          runId,
          userId,
          emailId,
          gmailId: message.id,
          metadata: metaWithPlatform,
          normalized,
          platform
        });

        companiesFound += createdCount;
        classified += 1;
        await ctx.runMutation(internalUpdateRunProgress as any, {
          runId,
          processedMessages: processed,
          newslettersClassified: classified,
          processedCompanies: companiesFound
        });
      }

      await ctx.runMutation(internalCompleteRun as any, {
        runId,
        processedMessages: processed,
        newslettersClassified: classified,
        processedCompanies: companiesFound
      });

      return { runId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown scan error';
      await ctx.runMutation(internalMarkRunFailed as any, { runId, reason });
      throw error;
    }
  }
});

async function listNewsletterCandidates(accessToken: string, query: string) {
  const messages: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;

  while (messages.length < MAX_MESSAGES) {
    const params = new URLSearchParams({
      q: query,
      maxResults: '100',
      includeSpamTrash: 'false'
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(`${GMAIL_API_BASE}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Gmail list failed (${response.status})`);
    }

    const json = (await response.json()) as {
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    };

    if (json.messages) {
      messages.push(...json.messages);
    }

    if (!json.nextPageToken) {
      break;
    }
    pageToken = json.nextPageToken;
  }

  return messages.slice(0, MAX_MESSAGES);
}

async function fetchMessageMetadata(accessToken: string, id: string) {
  const params = new URLSearchParams({
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'List-Id', 'Date'].join(',')
  });

  const response = await fetch(`${GMAIL_API_BASE}/${id}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Gmail metadata (${response.status})`);
  }

  const data = (await response.json()) as GmailMessageResponse;
  const headers = indexHeaders(data.payload.headers ?? []);

  return {
    id: data.id,
    threadId: data.threadId,
    subject: headers['subject'] ?? '',
    from: headers['from'] ?? '',
    listId: headers['list-id'] ?? null,
    sentAt: parseDateToMs(headers['date'], Number(data.internalDate))
  };
}

async function fetchFullMessage(accessToken: string, id: string) {
  const response = await fetch(`${GMAIL_API_BASE}/${id}?format=full`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Gmail message (${response.status})`);
  }

  return (await response.json()) as GmailMessageResponse;
}

interface GmailMessageResponse {
  id: string;
  threadId: string;
  internalDate: string;
  payload: GmailPayload;
}

interface GmailPayload {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
  headers?: { name: string; value: string }[];
}

function indexHeaders(headers: { name: string; value: string }[]) {
  return headers.reduce<Record<string, string>>((acc, header) => {
    acc[header.name.toLowerCase()] = header.value;
    return acc;
  }, {});
}

function parseDateToMs(headerDate?: string, fallback?: number): number {
  if (headerDate) {
    const parsed = Date.parse(headerDate);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback ?? Date.now();
}

interface ExtractionContext {
  runId: string;
  userId: string;
  emailId: string;
  gmailId: string;
  metadata: {
    subject: string;
    listId: string | null;
    from: string;
    sentAt: number;
    platform?: string;
  };
  normalized: {
    html: string | null;
    text: string | null;
    links: string[];
  };
  platform?: string;
}

async function extractCompaniesForEmail(ctx: any, context: ExtractionContext): Promise<number> {
  const text = context.normalized.text ?? context.normalized.html;
  if (!text) {
    return 0;
  }

  const linkCandidates = selectLinkCandidates(context.normalized.links);
  const snapshots = [];
  for (const candidate of linkCandidates) {
    try {
      const metadata = await fetchLinkMetadata(candidate);
      snapshots.push(metadata);
      await ctx.runMutation(internalUpsertLinkMetadata as any, {
        runId: context.runId,
        url: metadata.url,
        title: metadata.title ?? undefined,
        description: metadata.description ?? undefined,
        canonicalUrl: metadata.canonicalUrl ?? undefined,
        socialLinks: metadata.socialLinks ?? []
      });
    } catch {
      // Ignore fetch errors
    }

    if (snapshots.length >= MAX_LINK_SNAPSHOTS) break;
  }

  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildUserPrompt(context.gmailId, text, snapshots)
      }
    ],
    tools: [{ type: 'function', function: extractCompaniesSchema }],
    tool_choice: { type: 'function', function: { name: 'extract_companies' } }
  };

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getRequiredEnvVar('OPENAI_API_KEY')}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`OpenAI extraction failed (${response.status})`);
  }

  const json = await response.json();
  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  const parsed = toolCall?.function?.arguments ? safeJson(toolCall.function.arguments) : null;
  const companies = parsed?.companies ?? [];

  let created = 0;
  for (const company of companies) {
    const name = (company.name ?? '').trim();
    const summary = (company.one_line_summary ?? '').trim();
    if (!name || !summary) continue;

    const homepageUrl = sanitizeUrl(company.homepage_url);
    const altDomains = Array.isArray(company.alt_domains)
      ? company.alt_domains.map((domain: string) => domain.trim()).filter(Boolean)
      : [];
    const keySignals = Array.isArray(company.key_signals) ? company.key_signals : [];
    const snippets =
      Array.isArray(company.source_snippets) && company.source_snippets.length > 0
        ? company.source_snippets
        : [{ quote: summary }];
    const confidence = typeof company.confidence === 'number' ? clamp(company.confidence, 0, 1) : 0.5;
    const sourceEmails = Array.isArray(company.source_email_ids)
      ? company.source_email_ids
      : [context.gmailId];
    if (!sourceEmails.includes(context.gmailId)) {
      sourceEmails.push(context.gmailId);
    }

    const result = await ctx.runMutation(internalUpsertCompany as any, {
      userId: context.userId,
      runId: context.runId,
      emailId: context.emailId,
      gmailId: context.gmailId,
      name,
      homepageUrl,
      altDomains,
      oneLineSummary: summary,
      category: company.category,
      stage: company.stage,
      location: company.location ?? null,
      keySignals,
      snippets,
      platform: context.platform,
      confidence,
      sentAt: context.metadata.sentAt
    });

    if (result?.created) {
      created += 1;
    }
  }

  return created;
}

function buildUserPrompt(messageId: string, normalizedText: string, links: Array<{ url: string; title: string | null; description: string | null }>) {
  const snapshots = links
    .map((link) => {
      const meta = [link.title, link.description].filter(Boolean).join(' — ');
      return `URL: ${link.url}\nTITLE: ${link.title ?? 'Unknown'}\nMETA: ${meta || 'None'}`;
    })
    .join('\n\n');

  return `NEWSLETTER_EMAIL_ID: ${messageId}
NEWSLETTER_TEXT (normalized):
${normalizedText.slice(0, 12000)}

LINK SNAPSHOTS:
${snapshots || 'None'}

Task: Extract relevant CONSUMER STARTUPS. Respect the rules above.`;
}

function selectLinkCandidates(links: string[]): string[] {
  const uniques = new Set<string>();
  for (const link of links) {
    if (!/^https?:\/\//i.test(link)) continue;
    const domain = domainFromUrl(link);
    if (!domain || LINK_BLOCKLIST.some((blocked) => domain.includes(blocked))) {
      continue;
    }
    if (!uniques.has(link)) {
      uniques.add(link);
    }
  }
  return Array.from(uniques).slice(0, MAX_LINK_SNAPSHOTS);
}

function safeJson(payload: string) {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function sanitizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    return new URL(normalized).toString();
  } catch {
    return undefined;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
