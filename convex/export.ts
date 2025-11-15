import type { CompanyRecord, ExportMetadata } from '@relay/types';
import { action, internalMutation, query } from './_generated/server';
import { v } from 'convex/values';
import { api, internal } from './_generated/api';

const CSV_HEADER = [
  'name',
  'homepage_url',
  'one_line_summary',
  'category',
  'stage',
  'location',
  'key_signals',
  'score',
  'first_seen_at',
  'last_seen_at',
  'sources'
];

export const requestExport = action({
  args: {
    userId: v.string(),
    decision: v.optional(v.string()),
    runId: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    'use node';

    const companies = await ctx.runQuery(api.companies.listCompanies, {
      userId: args.userId,
      decision: args.decision,
      runId: args.runId
    });
    const csvBody = buildCsv(companies);
    const blob = new Blob([`\uFEFF${csvBody}`], { type: 'text/csv;charset=utf-8' });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    const filename = createFilename();
    const now = Date.now();

    const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
    const exportDoc = await ctx.runMutation(internal.export.internalRecordExport, {
      userId: args.userId,
      runId: args.runId,
      status: 'ready',
      filename,
      url: url ?? undefined,
      requestedAt: now,
      availableAt: now,
      expiresAt
    });

    const metadata: ExportMetadata = {
      id: exportDoc.id,
      runId: args.runId ?? '',
      userId: args.userId,
      status: 'ready',
      url,
      filename,
      requestedAt: now,
      availableAt: now,
      expiresAt
    };

    return metadata;
  }
});

export const listExports = query({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args): Promise<ExportMetadata[]> => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return [];
    }

    const docs = await ctx.db
      .query('exports')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .order('desc')
      .take(10);

    return docs.map((doc) => ({
      id: doc._id.toString(),
      runId: doc.runId?.toString() ?? '',
      userId: doc.userId.toString(),
      status: doc.status as ExportMetadata['status'],
      url: doc.url ?? null,
      filename: doc.filename,
      requestedAt: doc.requestedAt,
      availableAt: doc.availableAt ?? undefined,
      expiresAt: doc.expiresAt ?? undefined,
      failureReason: doc.failureReason ?? undefined
    }));
  }
});

function buildCsv(companies: CompanyRecord[]): string {
  const rows = companies.map((company) => [
    company.name,
    company.homepageUrl ?? '',
    company.oneLineSummary ?? '',
    company.category,
    company.stage,
    company.location ?? '',
    company.keySignals.join(';'),
    company.score.toFixed(2),
    new Date(company.firstSeenAt).toISOString(),
    new Date(company.lastSeenAt).toISOString(),
    company.sourceEmailIds.join(',')
  ]);

  return [CSV_HEADER, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function escapeCsv(value: string): string {
  const needs = /[",\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needs ? `"${escaped}"` : escaped;
}

function createFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `relay-export-${timestamp}.csv`;
}

export const internalRecordExport = internalMutation({
  args: {
    userId: v.string(),
    runId: v.optional(v.string()),
    status: v.string(),
    filename: v.string(),
    url: v.optional(v.string()),
    requestedAt: v.number(),
    availableAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    failureReason: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      throw new Error('Invalid user id');
    }
    const runId = args.runId ? ctx.db.normalizeId('runs', args.runId) ?? undefined : undefined;

    const exportId = await ctx.db.insert('exports', {
      userId,
      runId,
      status: args.status,
      filename: args.filename,
      url: args.url ?? undefined,
      requestedAt: args.requestedAt,
      availableAt: args.availableAt ?? undefined,
      expiresAt: args.expiresAt ?? undefined,
      failureReason: args.failureReason ?? undefined
    });

    return { id: exportId.toString() };
  }
});

export interface CsvRow {
  name: string;
  homepageUrl: string | null;
  oneLineSummary: string;
  category: string;
  stage: string;
  location: string | null;
  keySignals: string;
  decision: string;
  sourceEmails: string;
  confidence: number;
}

export function serializeCompaniesToRows(companies: CompanyRecord[]): CsvRow[] {
  return companies.map((company) => ({
    name: company.name,
    homepageUrl: company.homepageUrl,
    oneLineSummary: company.oneLineSummary,
    category: company.category,
    stage: company.stage,
    location: company.location,
    keySignals: company.keySignals.join(';'),
    decision: company.decision,
    sourceEmails: company.sourceEmailIds.join(','),
    confidence: company.confidence
  }));
}
