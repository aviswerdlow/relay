import type { CompanyDecision, CompanyRecord, CompanySignal } from '@relay/types';
import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';

const SIGNAL_WEIGHTS: Record<string, number> = {
  waitlist: 0.3,
  launch: 0.5,
  funding: 0.6,
  traction: 0.4,
  notable_founder: 0.3,
  partnership: 0.2
};

const DEFAULT_CATEGORY = 'Other';
const DEFAULT_STAGE = 'unknown';

export const internalUpsertCompany = internalMutation({
  args: {
    userId: v.string(),
    runId: v.string(),
    emailId: v.string(),
    gmailId: v.string(),
    name: v.string(),
    homepageUrl: v.optional(v.string()),
    altDomains: v.array(v.string()),
    oneLineSummary: v.string(),
    category: v.optional(v.string()),
    stage: v.optional(v.string()),
    location: v.optional(v.string()),
    platform: v.optional(v.string()),
    keySignals: v.array(v.string()),
    snippets: v.array(
      v.object({
        quote: v.string(),
        start: v.optional(v.number()),
        end: v.optional(v.number())
      })
    ),
    confidence: v.number(),
    sentAt: v.number()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!userId || !runId) {
      throw new Error('Invalid user or run id');
    }

    const now = Date.now();
    const normalizedName = normalizeName(args.name);
    const canonicalDomain = deriveCanonicalDomain(args.homepageUrl, args.altDomains);

    let existing = await findExistingCompany(ctx, userId, normalizedName, canonicalDomain);

    const mergedSignals = uniqueStrings([...(existing?.keySignals ?? []), ...args.keySignals]);
    const mergedSnippets = mergeSnippets(existing?.snippets ?? [], args.snippets);
    const sourceEmailIds = uniqueStrings([...(existing?.sourceEmailIds ?? []), args.gmailId]);
    const altDomains = uniqueStrings([...(existing?.altDomains ?? []), ...args.altDomains]);

    const firstSeenAt = existing ? Math.min(existing.firstSeenAt, args.sentAt) : args.sentAt;
    const lastSeenAt = Math.max(existing?.lastSeenAt ?? args.sentAt, args.sentAt);

    const recencyDays = Math.max(0, (Date.now() - args.sentAt) / (1000 * 60 * 60 * 24));
    const score = computeScore(args.confidence, mergedSignals, recencyDays, !existing, false);

    if (existing) {
      await ctx.db.patch(existing._id, {
        runId,
        name: args.name,
        homepageUrl: args.homepageUrl ?? existing.homepageUrl,
        altDomains,
        oneLineSummary: selectSummary(existing.oneLineSummary, args.oneLineSummary),
        category: args.category ?? existing.category ?? DEFAULT_CATEGORY,
        stage: args.stage ?? existing.stage ?? DEFAULT_STAGE,
        location: args.location ?? existing.location,
        platform: args.platform ?? existing.platform,
        keySignals: mergedSignals,
        sourceEmailIds,
        snippets: mergedSnippets,
        confidence: Math.max(existing.confidence, args.confidence),
        score,
        firstSeenAt,
        lastSeenAt,
        canonicalDomain,
        normalizedName,
        updatedAt: now
      });
      return { created: false };
    }

    await ctx.db.insert('companies', {
      runId,
      userId,
      name: args.name,
      homepageUrl: args.homepageUrl ?? undefined,
      altDomains,
      oneLineSummary: args.oneLineSummary,
      category: args.category ?? DEFAULT_CATEGORY,
      stage: args.stage ?? DEFAULT_STAGE,
      location: args.location ?? undefined,
      platform: args.platform ?? undefined,
      keySignals: mergedSignals,
      sourceEmailIds,
      snippets: mergedSnippets,
      confidence: args.confidence,
      decision: 'unreviewed',
      score,
      firstSeenAt,
      lastSeenAt,
      canonicalDomain,
      normalizedName,
      createdAt: now,
      updatedAt: now
    });
    return { created: true };
  }
});

export const internalUpsertLinkMetadata = internalMutation({
  args: {
    runId: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
    socialLinks: v.array(v.string())
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error('Invalid run id');
    }

    const existingDocs = await ctx.db.query('link_metadata').collect();
    const existing = existingDocs.find((doc: any) => doc.runId === runId && doc.url === args.url);

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title ?? existing.title,
        description: args.description ?? existing.description,
        canonicalUrl: args.canonicalUrl ?? existing.canonicalUrl,
        socialLinks: uniqueStrings([...(existing.socialLinks ?? []), ...args.socialLinks]),
        fetchedAt: Date.now()
      });
      return;
    }

    await ctx.db.insert('link_metadata', {
      runId,
      url: args.url,
      title: args.title ?? undefined,
      description: args.description ?? undefined,
      canonicalUrl: args.canonicalUrl ?? undefined,
      socialLinks: args.socialLinks,
      fetchedAt: Date.now()
    });
  }
});

export const listCompanies = query({
  args: {
    userId: v.string(),
    decision: v.optional(v.string()),
    runId: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    stages: v.optional(v.array(v.string())),
    platforms: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args): Promise<CompanyRecord[]> => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return [];
    }

    const docs = await getCompaniesForUser(ctx, userId, {
      runId: args.runId,
      decision: args.decision,
      categories: args.categories,
      stages: args.stages,
      platforms: args.platforms
    });
    return docs.map(toCompanyRecord);
  }
});

export const setCompanyDecision = mutation({
  args: {
    companyId: v.string(),
    decision: v.string()
  },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('companies', args.companyId);
    if (!id) {
      throw new Error('Invalid company id');
    }

    await ctx.db.patch(id, { decision: args.decision as CompanyDecision, updatedAt: Date.now() });
  }
});

export function computeScore(
  confidence: number,
  signals: string[],
  recencyDays: number,
  isNew: boolean,
  sponsorPenalty: boolean
): number {
  const signalScore = Math.min(
    1,
    signals.reduce((sum, signal) => sum + (SIGNAL_WEIGHTS[signal] ?? 0), 0)
  );
  const recencyScore = recencyDays <= 7 ? 1 : recencyDays <= 30 ? 0.5 : 0.2;
  const novelty = isNew ? 0.3 : 0;
  const penalty = sponsorPenalty ? 1.0 : 0;
  const raw = 0.5 * confidence + 0.2 * signalScore + 0.15 * recencyScore + 0.1 * novelty - 0.15 * penalty;
  return Math.max(0, Math.min(1, raw));
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

export function domainFromUrl(url?: string | null): string {
  if (!url) return '';
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) {
      k += 1;
    }
    if (a[i] !== b[k]) {
      transpositions += 1;
    }
    k += 1;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  const prefix = Math.min(
    4,
    [...a].findIndex((char, index) => char !== b[index]) === -1
      ? Math.min(a.length, b.length)
      : [...a].findIndex((char, index) => char !== b[index])
  );
  return jaro + 0.1 * prefix * (1 - jaro);
}

export function findBestMatch(
  candidates: Array<{ normalizedName: string; doc: any }>,
  normalizedName: string,
  threshold = 0.92
) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = jaroWinkler(candidate.normalizedName, normalizedName);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = candidate.doc;
    }
  }
  return best;
}

function deriveCanonicalDomain(homepageUrl?: string, altDomains: string[] = []): string {
  const domains = [homepageUrl, ...altDomains].map((value) => domainFromUrl(value)).filter(Boolean);
  return domains[0] ?? '';
}

async function findExistingCompany(ctx: any, userId: any, normalizedName: string, canonicalDomain: string) {
  if (canonicalDomain) {
    const byDomain = await ctx.db
      .query('companies')
      .withIndex('by_domain', (q: any) => q.eq('userId', userId).eq('canonicalDomain', canonicalDomain))
      .unique();
    if (byDomain) return byDomain;
  }

  const byName = await ctx.db
    .query('companies')
    .withIndex('by_normalized_name', (q: any) => q.eq('userId', userId).eq('normalizedName', normalizedName))
    .unique();
  if (byName) return byName;

  const candidates = await ctx.db
    .query('companies')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .take(50);
  return findBestMatch(
    candidates.map((doc: any) => ({ normalizedName: doc.normalizedName, doc })),
    normalizedName
  );
}

function mergeSnippets(existing: any[], incoming: any[]) {
  const combined = [...existing, ...incoming];
  return combined.slice(0, 4);
}

function selectSummary(current: string, incoming: string): string {
  if (!current) return incoming;
  if (!incoming) return current;
  if (incoming.length > current.length && incoming.length <= 140) {
    return incoming;
  }
  return current;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value && value.trim().length > 0)));
}

export function toCompanyRecord(doc: any): CompanyRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    homepageUrl: doc.homepageUrl ?? null,
    altDomains: doc.altDomains ?? [],
    oneLineSummary: doc.oneLineSummary,
    category: doc.category,
    stage: doc.stage,
    location: doc.location ?? null,
    keySignals: doc.keySignals ?? [],
    sourceEmailIds: doc.sourceEmailIds ?? [],
    sourceSnippets: doc.snippets ?? [],
    confidence: doc.confidence,
    decision: doc.decision,
    newsletterPlatform: doc.platform ?? undefined,
    score: doc.score,
    firstSeenAt: doc.firstSeenAt,
    lastSeenAt: doc.lastSeenAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function getCompaniesForUser(
  ctx: any,
  userId: any,
  filters: {
    runId?: string;
    decision?: string;
    categories?: string[];
    stages?: string[];
    platforms?: string[];
  } = {}
) {
  let queryBuilder = ctx.db.query('companies').withIndex('by_user', (q: any) => q.eq('userId', userId));

  if (filters.runId) {
    const runId = ctx.db.normalizeId('runs', filters.runId);
    if (runId) {
      queryBuilder = queryBuilder.filter((q: any) => q.eq(q.field('runId'), runId as any));
    }
  }

  if (filters.decision && filters.decision !== 'all') {
    queryBuilder = queryBuilder.filter((q: any) => q.eq('decision', filters.decision));
  }

  if (filters.categories && filters.categories.length > 0) {
    const set = new Set(filters.categories);
    queryBuilder = queryBuilder.filter((q: any) => set.has(q.field('category')));
  }

  if (filters.stages && filters.stages.length > 0) {
    const set = new Set(filters.stages);
    queryBuilder = queryBuilder.filter((q: any) => set.has(q.field('stage')));
  }

  if (filters.platforms && filters.platforms.length > 0) {
    const set = new Set(filters.platforms);
    queryBuilder = queryBuilder.filter((q: any) => set.has(q.field('platform')));
  }

  return await queryBuilder.collect();
}
