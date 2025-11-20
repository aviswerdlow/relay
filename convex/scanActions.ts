'use node';

import { action } from './_generated/server';
import { v } from 'convex/values';
import { GOOGLE_TOKEN_ENDPOINT, defaultUserSettings, internalGetTokensForUser, internalGetUser } from './auth';
import {
  internalCompleteRun,
  internalCreateRun,
  internalMarkRunFailed,
  internalStoreEmailBody,
  internalStoreEmailMetadata,
  internalLogRunNote,
  internalUpdateRunTotals
} from './scan';
import { deriveAesKey, decryptSecret, encryptSecret } from './crypto';
import { buildNewsletterQuery } from './gmail';
import { assertRequiredScopes, getRequiredEnvVar } from './util';
import { extractCompaniesSchema } from './extractionSchema';
import { fetchLinkMetadata } from './linkFetcher';
import { domainFromUrl, internalUpsertCompany, internalUpsertLinkMetadata } from './companies';
import { internal } from './_generated/api';
import { runScanPipeline } from './scanPipeline';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_MESSAGES = 200;
const MAX_LINK_SNAPSHOTS = 2;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini-2024-07-18';
const SYSTEM_PROMPT = [
  'You are an obsessive consumer venture capitalist combing through newsletters.',
  'Read the ENTIRE email carefully (headers, intros, body, footers) and extract every NEW CONSUMER COMPANY worth investigating.',
  'Do not hallucinate. If no new startup is mentioned, return an empty list.',
  'Focus on consumer products/services (b2c, creator tools, social, marketplaces, commerce, consumer AI, etc.).',
  'Ignore press about public companies, large incumbents, or pure funding recaps unless a new consumer startup is involved.',
  'Whenever you surface a company, capture specific evidence snippets (quotes) from the email proving the insight.',
  'Think like a skeptical investor: highlight why this company is noteworthy (launch, traction, funding, notable founder, etc.).',
  'Return precise, concise data.'
].join(' ');
const LINK_BLOCKLIST = ['substack.com', 'substackmail.com', 'beehiiv.com', 'buttondown.email', 'gmail.com'];
const OPENAI_INPUT_COST_PER_TOKEN_USD = 0.15 / 1_000_000;
const OPENAI_OUTPUT_COST_PER_TOKEN_USD = 0.6 / 1_000_000;
const RUN_COST_CAP_USD = deriveRunCostCap();
const MAX_ERROR_CONTEXT_LENGTH = 512;
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const UNKNOWN_PLATFORM_LOG_LIMIT = 5;

export const startScan = action({
  args: {
    userId: v.string(),
    timeWindowDays: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    console.log('scan:start', { userId: args.userId, timeWindowDays: args.timeWindowDays });
    const user = (await ctx.runQuery(internal.auth.internalGetUser, { userId: args.userId })) as {
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

    const tokens = await ctx.runQuery(internal.auth.internalGetTokensForUser, { userId });
    if (!tokens) {
      throw new Error('No Google OAuth tokens available for user');
    }

    const tokenScopes = tokens.scopes ?? [];
    assertRequiredScopes(tokenScopes, ['https://www.googleapis.com/auth/gmail.readonly']);

    const query = buildNewsletterQuery(timeWindowDays);
    const runResponse = await ctx.runMutation(internal.scan.internalCreateRun, { userId, timeWindowDays });
    const runId = runResponse.runId;

    let accessToken: string;
    try {
      accessToken = await ensureFreshAccessToken(ctx, runId, userId, tokens, encryptionKey);
    } catch (error) {
      await logRunError(ctx, runId, 'google_token_refresh_failed', formatErrorMessage(error));
      throw error;
    }

    try {
      const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
      const retentionExpiry = Date.now() + retentionMs;

      const result = await runScanPipeline(
        {
          runId,
          userId,
          costCapUsd: RUN_COST_CAP_USD,
          retentionExpiry,
          unknownPlatformLogLimit: UNKNOWN_PLATFORM_LOG_LIMIT
        },
        {
          listMessages: async () => {
            const messages = await listNewsletterCandidates(accessToken, query, runId).catch(async (err) => {
              await logRunError(ctx, runId, 'gmail_list_failed', formatErrorMessage(err), { query });
              throw err;
            });
            if (messages.length === 0) {
              console.log('scan:no_candidates_found', { runId, userId, timeWindowDays, query });
            }
            return messages;
          },
          fetchMetadata: async (gmailId: string) => {
            const meta = await fetchMessageMetadata(accessToken, gmailId);
            return { ...meta, gmailId };
          },
          fetchFullMessage: async (gmailId: string) => {
            return await fetchFullMessage(accessToken, gmailId);
          },
          storeEmailMetadata: async (input) => {
            return await ctx.runMutation(internal.scan.internalStoreEmailMetadata, {
              runId,
              gmailId: input.gmailId,
              threadId: input.threadId,
              subject: input.subject ?? '',
              from: input.from,
              listId: input.listId ?? undefined,
              platform: input.platform,
              sentAt: input.sentAt
            });
          },
          storeEmailBody: async (input) => {
            await ctx.runMutation(internal.scan.internalStoreEmailBody, {
              runId,
              emailId: input.emailId,
              normalizedHtml: input.normalized.html ?? undefined,
              normalizedText: input.normalized.text ?? undefined,
              links: input.normalized.links,
              retentionExpiry: input.retentionExpiry
            });
          },
          extractCompanies: async (input) => {
            try {
              return await extractCompaniesForEmail(ctx, {
                runId,
                userId,
                emailId: input.emailId,
                gmailId: input.gmailId,
                metadata: input.metadata,
                normalized: input.normalized,
                platform: input.platform
              });
            } catch (err) {
              await logRunError(ctx, runId, 'openai_extraction_failed', formatErrorMessage(err), {
                gmailId: input.gmailId
              });
              return null;
            }
          },
          updateProgress: async ({ processedMessages, newslettersClassified, processedCompanies, costUsd }) => {
            await ctx.runMutation(internal.scan.internalUpdateRunProgress, {
              runId,
              processedMessages,
              newslettersClassified,
              processedCompanies,
              costUsd
            });
          },
          markFailed: async (reason: string) => {
            await ctx.runMutation(internal.scan.internalMarkRunFailed, { runId, reason });
          },
          completeRun: async ({ processedMessages, newslettersClassified, processedCompanies }) => {
            await ctx.runMutation(internal.scan.internalCompleteRun, {
              runId,
              processedMessages,
              newslettersClassified,
              processedCompanies
            });
          },
          setTotals: async (totalMessages: number) => {
            await ctx.runMutation(internal.scan.internalUpdateRunTotals, { runId, totalMessages });
          },
          logError: async (code, message, context) => {
            await logRunError(ctx, runId, code, message, context);
          },
          logInfo: async (_code, context) => {
            console.log('scan:processing_unknown_platform', { runId, ...(context ?? {}) });
          }
        }
      );

      console.log('scan:complete', {
        runId,
        processedMessages: result.processedMessages,
        newslettersClassified: result.newslettersClassified,
        processedCompanies: result.processedCompanies,
        totalCostUsd: Number(result.totalCostUsd.toFixed(4))
      });
      return { runId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown scan error';
      await logRunError(ctx, runId, 'scan_failed', reason);
      await ctx.runMutation(internal.scan.internalMarkRunFailed, { runId, reason });
      throw error;
    }
  }
});

export const enqueueScan = action({
  args: {
    userId: v.string(),
    timeWindowDays: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    console.log('scan:enqueue', { userId: args.userId, timeWindowDays: args.timeWindowDays });
    const user = (await ctx.runQuery(internal.auth.internalGetUser, { userId: args.userId })) as {
      _id: { toString(): string };
      settings: { timeWindowDays: number; retentionDays: number };
    } | null;
    if (!user) {
      throw new Error('User not found for scan');
    }

    const settings = user.settings ?? defaultUserSettings();
    const userId = user._id.toString();
    const timeWindowDays = args.timeWindowDays ?? settings.timeWindowDays ?? 90;

    const tokens = await ctx.runQuery(internal.auth.internalGetTokensForUser, { userId });
    if (!tokens) {
      throw new Error('No Google OAuth tokens available for user');
    }

    const tokenScopes = tokens.scopes ?? [];
    assertRequiredScopes(tokenScopes, ['https://www.googleapis.com/auth/gmail.readonly']);

    const runResponse = await ctx.runMutation(internal.scan.internalCreateRun, { userId, timeWindowDays });
    const runId = runResponse.runId;

    console.log('scan:enqueue_created_run', { userId, runId, timeWindowDays });
    return {
      runId,
      timeWindowDays,
      retentionDays: settings.retentionDays ?? defaultUserSettings().retentionDays
    };
  }
});

export const debugListGmail = action({
  args: {
    userId: v.string(),
    timeWindowDays: v.optional(v.number()),
    maxResults: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(internal.auth.internalGetUser, { userId: args.userId })) as {
      _id: { toString(): string };
      settings: { timeWindowDays: number; retentionDays: number };
    } | null;
    if (!user) {
      throw new Error('User not found for debug list');
    }

    const settings = user.settings ?? defaultUserSettings();
    const userId = user._id.toString();
    const timeWindowDays = args.timeWindowDays ?? settings.timeWindowDays ?? 90;
    const tokens = await ctx.runQuery(internal.auth.internalGetTokensForUser, { userId });
    if (!tokens) {
      throw new Error('No Google OAuth tokens available for user');
    }

    const encryptionKey = deriveAesKey(getRequiredEnvVar('TOKEN_ENCRYPTION_SECRET'));
    const runId = `debug-${Date.now()}`;
    const accessToken = await ensureFreshAccessToken(ctx, runId, userId, tokens, encryptionKey);
    const query = buildNewsletterQuery(timeWindowDays);
    const maxResults = Math.min(Math.max(1, args.maxResults ?? 20), 500);

    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults),
      includeSpamTrash: 'false'
    });

    const response = await fetch(`${GMAIL_API_BASE}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gmail debug list failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as {
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    };

    const sampleIds = (json.messages ?? []).slice(0, Math.min(5, json.messages?.length ?? 0));
    const sampleMetadata: Array<Record<string, unknown>> = [];
    const sampleFullBodies: Array<{ gmailId: string; headers: Record<string, string>; snippet?: string }> = [];
    for (const message of sampleIds) {
      try {
        const meta = await fetchMessageMetadata(accessToken, message.id);
        sampleMetadata.push(meta);
        try {
          const full = await fetchFullMessage(accessToken, message.id);
          const headers = indexHeaders(full.payload.headers ?? []);
          sampleFullBodies.push({
            gmailId: message.id,
            headers,
            snippet: full.snippet
          });
        } catch (error) {
          sampleFullBodies.push({ gmailId: message.id, headers: {}, snippet: formatErrorMessage(error) });
        }
      } catch (error) {
        sampleMetadata.push({ id: message.id, error: formatErrorMessage(error) });
        sampleFullBodies.push({ gmailId: message.id, headers: {}, snippet: formatErrorMessage(error) });
      }
    }

    console.log('scan:debug_gmail_summary', {
      runId,
      userId,
      query,
      requested: maxResults,
      fetched: json.messages?.length ?? 0,
      resultSizeEstimate: json.resultSizeEstimate ?? null,
      sampleIds: sampleIds.map((m) => m.id)
    });

    return {
      query,
      requested: maxResults,
      fetched: json.messages?.length ?? 0,
      resultSizeEstimate: json.resultSizeEstimate ?? null,
      nextPageToken: json.nextPageToken ?? null,
      sample: sampleMetadata,
      sampleFull: sampleFullBodies
    };
  }
});

async function ensureFreshAccessToken(
  ctx: any,
  runId: string,
  userId: string,
  tokens: { accessTokenEnc: string; refreshTokenEnc: string; expiry?: number },
  encryptionKey: Buffer
): Promise<string> {
  const now = Date.now();
  const expiresAt = typeof tokens.expiry === 'number' ? tokens.expiry : 0;
  const decryptedAccessToken = decryptSecret(tokens.accessTokenEnc, encryptionKey);
  if (expiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS > now) {
    return decryptedAccessToken;
  }

  const refreshToken = decryptSecret(tokens.refreshTokenEnc, encryptionKey);
  if (!refreshToken) {
    throw new Error('Missing Google refresh token');
  }

  const refreshed = await refreshGoogleAccessToken(refreshToken);
  await ctx.runMutation(internal.auth.internalUpdateAccessToken, {
    userId,
    accessTokenEnc: encryptSecret(refreshed.accessToken, encryptionKey),
    expiry: refreshed.expiry
  });
  console.log('scan:access_token_refreshed', { runId, expiresAt: refreshed.expiry });
  return refreshed.accessToken;
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: number }> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getRequiredEnvVar('GOOGLE_CLIENT_ID'),
      client_secret: getRequiredEnvVar('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google refresh failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error('Google refresh response missing access_token');
  }

  const expiresInSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    expiry: Date.now() + expiresInSeconds * 1000
  };
}

async function listNewsletterCandidates(accessToken: string, query: string, runId: string) {
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

    console.log('scan:gmail_page', {
      runId,
      fetched: json.messages?.length ?? 0,
      totalSoFar: messages.length,
      nextPageToken: json.nextPageToken ?? null
    });

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

async function extractCompaniesForEmail(
  ctx: any,
  context: ExtractionContext
): Promise<{ created: number; costUsd: number }> {
  const text = context.normalized.text ?? context.normalized.html;
  if (!text) {
    return { created: 0, costUsd: 0 };
  }

  const linkCandidates = selectLinkCandidates(context.normalized.links);
      const snapshots = [];
  for (const candidate of linkCandidates) {
    try {
      const metadata = await fetchLinkMetadata(candidate);
      snapshots.push(metadata);
      await ctx.runMutation(internal.companies.internalUpsertLinkMetadata, {
        runId: context.runId,
        url: metadata.url,
        title: metadata.title ?? undefined,
        description: metadata.description ?? undefined,
        canonicalUrl: metadata.canonicalUrl ?? undefined,
        socialLinks: metadata.socialLinks ?? []
      });
    } catch (error) {
      await logRunError(ctx, context.runId, 'link_snapshot_failed', formatErrorMessage(error), {
        url: candidate
      });
    }

    if (snapshots.length >= MAX_LINK_SNAPSHOTS) break;
  }

  const userPrompt = buildUserPrompt(context.gmailId, text, snapshots);
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: userPrompt
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
  const rawArguments = typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '';
  const parsed = rawArguments ? safeJson(rawArguments) : null;
  const companies = parsed?.companies ?? [];
  const estimatedCost = estimateOpenAiCostUsd(json.usage ?? null, {
    promptChars: SYSTEM_PROMPT.length + userPrompt.length,
    completionChars: rawArguments.length
  });

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

    const result = await ctx.runMutation(internal.companies.internalUpsertCompany, {
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

  return { created, costUsd: estimatedCost };
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

function estimateOpenAiCostUsd(
  usage: { prompt_tokens?: number; completion_tokens?: number } | null,
  fallback: { promptChars: number; completionChars: number }
): number {
  const promptTokens =
    typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : approximateTokensFromChars(fallback.promptChars);
  const completionTokens =
    typeof usage?.completion_tokens === 'number'
      ? usage.completion_tokens
      : approximateTokensFromChars(fallback.completionChars);
  const total =
    promptTokens * OPENAI_INPUT_COST_PER_TOKEN_USD + completionTokens * OPENAI_OUTPUT_COST_PER_TOKEN_USD;
  return Number.isFinite(total) ? Number(total.toFixed(6)) : 0;
}

function approximateTokensFromChars(chars: number) {
  if (!Number.isFinite(chars) || chars <= 0) {
    return 0;
  }
  return Math.ceil(chars / 4);
}

function deriveRunCostCap() {
  const raw = process.env.SCAN_COST_CAP_USD;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 2;
}

async function logRunError(
  ctx: any,
  runId: string,
  code: string,
  message?: string,
  context?: Record<string, unknown>
) {
  await ctx.runMutation(internal.scan.internalLogRunNote, {
    runId,
    code,
    message: message ? truncateString(message, MAX_ERROR_CONTEXT_LENGTH) : undefined,
    context: context ? truncateString(JSON.stringify(context), MAX_ERROR_CONTEXT_LENGTH) : undefined
  });
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function truncateString(value: string, limit: number) {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, Math.max(0, limit - 3))}...`;
}
