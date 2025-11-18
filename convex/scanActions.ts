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
import { buildNewsletterQuery, classifyNewsletterFromMetadata, refinePlatformWithBody } from './gmail';
import { normalizeMessageBody } from './nlp';
import { assertRequiredScopes, getRequiredEnvVar } from './util';
import { extractCompaniesSchema } from './extractionSchema';
import { fetchLinkMetadata } from './linkFetcher';
import { domainFromUrl, internalUpsertCompany, internalUpsertLinkMetadata } from './companies';
import { internal } from './_generated/api';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_MESSAGES = 200;
const MAX_LINK_SNAPSHOTS = 2;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini-2024-07-18';
const SYSTEM_PROMPT =
  'You extract mentions of NEW CONSUMER COMPANIES from newsletter text and optional landing pages. Do not invent companies. Exclude sponsored or public companies. Always include 1-2 evidence snippets.';
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

    const costCapUsd = RUN_COST_CAP_USD;
    let totalCostUsd = 0;
    let abortedByBudget = false;

    try {
      const messages = await listNewsletterCandidates(accessToken, query, runId).catch(async (err) => {
        await logRunError(ctx, runId, 'gmail_list_failed', formatErrorMessage(err), { query });
        throw err;
      });
      console.log('scan:messages_listed', { runId, count: messages.length, query });
      if (messages.length === 0) {
        console.log('scan:no_candidates_found', { runId, userId, timeWindowDays, query });
      }
      await ctx.runMutation(internal.scan.internalUpdateRunTotals, { runId, totalMessages: messages.length });

      const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000;
      const retentionExpiry = Date.now() + retentionMs;

      let processed = 0;
      let classified = 0;
      let companiesFound = 0;
      let loggedUnknownPlatforms = 0;
      const pushProgress = async () => {
        await ctx.runMutation(internal.scan.internalUpdateRunProgress, {
          runId,
          processedMessages: processed,
          newslettersClassified: classified,
          processedCompanies: companiesFound,
          costUsd: Number(totalCostUsd.toFixed(4))
        });
      };

      for (const message of messages) {
        processed += 1;

        const meta = await fetchMessageMetadata(accessToken, message.id).catch(async (err) => {
          await logRunError(ctx, runId, 'gmail_metadata_failed', formatErrorMessage(err), { gmailId: message.id });
          await pushProgress();
          return null;
        });
        if (!meta) {
          console.warn('scan:metadata_missing', { runId, gmailId: message.id });
          continue;
        }

        const platformGuess = classifyNewsletterFromMetadata({
          from: meta.from,
          listId: meta.listId ?? undefined,
          subject: meta.subject ?? undefined
        });

        if (platformGuess === 'unknown' && loggedUnknownPlatforms < UNKNOWN_PLATFORM_LOG_LIMIT) {
          console.log('scan:unknown_platform_headers', {
            runId,
            gmailId: message.id,
            from: meta.from,
            listId: meta.listId,
            subject: (meta.subject ?? '').slice(0, 120)
          });
          loggedUnknownPlatforms += 1;
        }

        const fullMessage = await fetchFullMessage(accessToken, message.id).catch(async (err) => {
          await logRunError(ctx, runId, 'gmail_body_failed', formatErrorMessage(err), { gmailId: message.id });
          await pushProgress();
          return null;
        });
        if (!fullMessage) {
          console.warn('scan:body_missing', { runId, gmailId: message.id });
          continue;
        }

        const normalized = normalizeMessageBody(fullMessage.payload);
        const platform = refinePlatformWithBody(normalized.html ?? normalized.text ?? null, platformGuess);

        if (platform === 'unknown') {
          console.log('scan:skip_unknown_platform', { runId, gmailId: message.id });
          await pushProgress();
          continue;
        }

        const metaWithPlatform = { ...meta, platform };

        const { emailId } = await ctx.runMutation(internal.scan.internalStoreEmailMetadata, {
          runId,
          gmailId: message.id,
          threadId: message.threadId,
          subject: meta.subject ?? '',
          from: meta.from,
          listId: meta.listId ?? undefined,
          platform,
          sentAt: meta.sentAt
        });

        await ctx.runMutation(internal.scan.internalStoreEmailBody, {
          runId,
          emailId,
          normalizedHtml: normalized.html ?? undefined,
          normalizedText: normalized.text ?? undefined,
          links: normalized.links,
          retentionExpiry
        });

        const extraction = await extractCompaniesForEmail(ctx, {
          runId,
          userId,
          emailId,
          gmailId: message.id,
          metadata: metaWithPlatform,
          normalized,
          platform
        }).catch(async (err) => {
          await logRunError(ctx, runId, 'openai_extraction_failed', formatErrorMessage(err), {
            gmailId: message.id
          });
          await pushProgress();
          return null;
        });
        if (!extraction) {
          continue;
        }

        companiesFound += extraction.created;
        classified += 1;
        totalCostUsd += extraction.costUsd;
        await pushProgress();

        if (totalCostUsd >= costCapUsd) {
          abortedByBudget = true;
          const spent = Number(totalCostUsd.toFixed(4));
          const reason = `Scan aborted: estimated OpenAI spend $${spent.toFixed(2)} exceeded $${costCapUsd.toFixed(
            2
          )} limit`;
          await logRunError(ctx, runId, 'cost_cap_exceeded', reason, { spentUsd: spent, capUsd: costCapUsd });
          await ctx.runMutation(internal.scan.internalMarkRunFailed, { runId, reason });
          break;
        }
      }

      if (!abortedByBudget) {
        await ctx.runMutation(internal.scan.internalCompleteRun, {
          runId,
          processedMessages: processed,
          newslettersClassified: classified,
          processedCompanies: companiesFound
        });
      }

      console.log('scan:complete', {
        runId,
        processedMessages: processed,
        newslettersClassified: classified,
        processedCompanies: companiesFound,
        totalCostUsd: Number(totalCostUsd.toFixed(4))
      });
      return { runId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown scan error';
      await logRunError(ctx, runId, 'scan_failed', reason);
      if (!abortedByBudget) {
        await ctx.runMutation(internal.scan.internalMarkRunFailed, { runId, reason });
      }
      throw error;
    }
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
