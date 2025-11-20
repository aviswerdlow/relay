import { runScanPipeline, type ScanPipelineDeps } from '../../../../convex/scanPipeline';
import { buildNewsletterQuery } from '../../../../convex/gmail';
import { normalizeMessageBody, type NormalizedMessage } from '../../../../convex/nlp';
import { extractCompaniesSchema } from '../../../../convex/extractionSchema';
import { fetchLinkMetadata } from '../../../../convex/linkFetcher';
import { domainFromUrl } from '../../../../convex/companies';
import { deriveAesKey, decryptSecret, encryptSecret } from '../../../../convex/crypto';
import { requireEnv } from '../env';
import { createConvexClient, callMutation, callQuery } from '../convexClient';
import { getAccessToken } from '../convexToken';

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
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

export async function scanEmail(input: {
  runId: string;
  userId: string;
  retentionExpiry: number;
  timeWindowDays?: number;
  unknownPlatformLogLimit?: number;
}): Promise<{
  processedMessages: number;
  newslettersClassified: number;
  processedCompanies: number;
  totalCostUsd: number;
  abortedByBudget: boolean;
}> {
  const { convex } = createConvexClient();

  const user = await callQuery<{ settings?: { timeWindowDays?: number; retentionDays?: number } } | null>(
    convex,
    'auth:internalGetUser',
    { userId: input.userId }
  );
  const tokens = await callQuery<
    | {
        accessTokenEnc: string;
        refreshTokenEnc: string;
        expiry?: number;
        scopes?: string[];
      }
    | null
  >(convex, 'auth:internalGetTokensForUser', { userId: input.userId });
  if (!tokens) throw new Error('No Google OAuth tokens available for user');

  const encryptionKey = deriveAesKey(requireEnv('TOKEN_ENCRYPTION_SECRET'));
  const accessToken = await ensureFreshAccessToken(convex, input.runId, input.userId, tokens, encryptionKey);

  const timeWindowDays = input.timeWindowDays ?? user?.settings?.timeWindowDays ?? 90;
  const query = buildNewsletterQuery(timeWindowDays);
  const retentionMs = (user?.settings?.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  const retentionExpiry = input.retentionExpiry ?? Date.now() + retentionMs;

  const deps: ScanPipelineDeps = {
    listMessages: async () => listNewsletterCandidates(accessToken, query, input.runId),
    fetchMetadata: async (gmailId) => fetchMessageMetadata(accessToken, gmailId),
    fetchFullMessage: async (gmailId) => fetchFullMessage(accessToken, gmailId),
    storeEmailMetadata: async (payload) => {
      return await callMutation(convex, 'scan:internalStoreEmailMetadata', {
        runId: input.runId,
        gmailId: payload.gmailId,
        threadId: payload.threadId,
        subject: payload.subject ?? '',
        from: payload.from,
        listId: payload.listId ?? undefined,
        platform: payload.platform,
        sentAt: payload.sentAt
      });
    },
    storeEmailBody: async (payload) => {
      return await callMutation(convex, 'scan:internalStoreEmailBody', {
        runId: input.runId,
        emailId: payload.emailId,
        normalizedHtml: payload.normalized.html ?? undefined,
        normalizedText: payload.normalized.text ?? undefined,
        links: payload.normalized.links,
        retentionExpiry
      });
    },
    extractCompanies: async (payload) => {
      return await extractCompaniesForEmail(convex, input.runId, input.userId, payload);
    },
    updateProgress: async ({ processedMessages, newslettersClassified, processedCompanies, costUsd }) => {
      await callMutation(convex, 'scan:internalUpdateRunProgress', {
        runId: input.runId,
        processedMessages,
        newslettersClassified,
        processedCompanies,
        costUsd
      });
    },
    markFailed: async (reason: string) => {
      await callMutation(convex, 'scan:internalMarkRunFailed', { runId: input.runId, reason });
    },
    completeRun: async ({ processedMessages, newslettersClassified, processedCompanies }) => {
      await callMutation(convex, 'scan:internalCompleteRun', {
        runId: input.runId,
        processedMessages,
        newslettersClassified,
        processedCompanies
      });
    },
    setTotals: async (totalMessages: number) => {
      await callMutation(convex, 'scan:internalUpdateRunTotals', { runId: input.runId, totalMessages });
    },
    logError: async (code, message, context) => {
      await callMutation(convex, 'scan:internalLogRunNote', {
        runId: input.runId,
        code,
        message: message ? truncateString(message, 512) : undefined,
        context: context ? truncateString(JSON.stringify(context), 512) : undefined
      });
    },
    logInfo: async (_code, _context) => {
      // No-op to keep logs minimal in worker; could forward to console if needed.
    }
  };

  return await runScanPipeline(
    {
      runId: input.runId,
      userId: input.userId,
      costCapUsd: deriveRunCostCap(),
      retentionExpiry,
      unknownPlatformLogLimit: input.unknownPlatformLogLimit
    },
    deps
  );
}

async function ensureFreshAccessToken(
  convex: any,
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
  await callMutation(convex, 'auth:internalUpdateAccessToken', {
    userId,
    accessTokenEnc: encryptSecret(refreshed.accessToken, encryptionKey),
    expiry: refreshed.expiry
  });
  return refreshed.accessToken;
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: number }> {
  const response = await fetch(process.env.GOOGLE_TOKEN_ENDPOINT ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
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
    gmailId: data.id,
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

async function extractCompaniesForEmail(
  convex: any,
  runId: string,
  userId: string,
  context: {
    emailId: string;
    gmailId: string;
    metadata: {
      subject: string;
      listId: string | null;
      from: string;
      sentAt: number;
      platform?: string;
    };
    normalized: NormalizedMessage;
    platform?: string;
  }
): Promise<{ created: number; costUsd: number }> {
  const text = context.normalized.text ?? context.normalized.html;
  if (!text) {
    return { created: 0, costUsd: 0 };
  }

  const linkCandidates = selectLinkCandidates(context.normalized.links);
  const snapshots: Array<{ url: string; title: string | null; description: string | null; canonicalUrl?: string | null; socialLinks?: string[] }> = [];
  for (const candidate of linkCandidates) {
    try {
      const metadata = await fetchLinkMetadata(candidate);
      snapshots.push(metadata);
      await callMutation(convex, 'companies:internalUpsertLinkMetadata', {
        runId,
        url: metadata.url,
        title: metadata.title ?? undefined,
        description: metadata.description ?? undefined,
        canonicalUrl: metadata.canonicalUrl ?? undefined,
        socialLinks: metadata.socialLinks ?? []
      });
    } catch (error) {
      await callMutation(convex, 'scan:internalLogRunNote', {
        runId,
        code: 'link_snapshot_failed',
        message: formatErrorMessage(error),
        context: truncateString(JSON.stringify({ url: candidate }), 512)
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
      Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`
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

    const result = await callMutation(convex, 'companies:internalUpsertCompany', {
      userId,
      runId,
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

    if ((result as any)?.created) {
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

interface GmailMessageResponse {
  id: string;
  threadId: string;
  internalDate: string;
  payload: {
    mimeType?: string;
    filename?: string;
    body?: { data?: string };
    parts?: GmailPayload[];
    headers?: { name: string; value: string }[];
  };
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
