import type { EmailBody, EmailMetadata, NewsletterPlatform, ScanProgress } from '@relay/types';
import { internalMutation, internalQuery, query } from './_generated/server.js';
import { v } from 'convex/values';

const RUN_NOT_FOUND = 'Run not found';
const RUN_LIST_LIMIT = 50;

export const listRunsForUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return [];
    }
    const limit = Math.min(Math.max(1, args.limit ?? 10), RUN_LIST_LIMIT);
    const runs = await ctx.db.query('runs').withIndex('by_user', (q) => q.eq('userId', userId)).collect();
    return runs
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, limit)
      .map((run) => ({
        runId: run._id.toString(),
        status: run.status,
        totalMessages: run.totalMessages,
        processedMessages: run.processedMessages,
        processedCompanies: run.processedCompanies,
        newslettersClassified: run.newslettersClassified,
        costUsd: run.costUsd ?? 0,
        errorCount: run.errorCount ?? 0,
        failureReason: run.failureReason ?? null,
        updatedAt: run.updatedAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt ?? null
      }));
  }
});

export const getScanProgress = query({
  args: {
    runId: v.string()
  },
  handler: async (ctx, args): Promise<ScanProgress> => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    const run = await ctx.db.get(runId);
    if (!run) {
      throw new Error(RUN_NOT_FOUND);
    }

    return {
      runId: args.runId,
      status: run.status as ScanProgress['status'],
      totalMessages: run.totalMessages,
      processedMessages: run.processedMessages,
      processedCompanies: run.processedCompanies,
      newslettersClassified: run.newslettersClassified,
      costUsd: run.costUsd ?? 0,
      errorCount: run.errorCount ?? 0,
      recentErrors: Array.isArray(run.notes) ? run.notes.slice(-5) : [],
      failureReason: run.failureReason ?? undefined,
      lastUpdatedAt: run.updatedAt
    };
  }
});

export const listEmailsForRun = query({
  args: {
    runId: v.string()
  },
  handler: async (ctx, args): Promise<{ metadata: EmailMetadata[]; bodies: EmailBody[] }> => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      return { metadata: [], bodies: [] };
    }

    const emails = await ctx.db
      .query('emails')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect();

    const bodies = await ctx.db
      .query('email_bodies')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .collect();

    return {
      metadata: emails.map((email) => ({
        id: email._id.toString(),
        runId: args.runId,
        gmailId: email.gmailId,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        listId: email.listId ?? null,
        newsletterPlatform: email.platform as NewsletterPlatform,
        sentAt: email.sentAt
      })),
      bodies: bodies.map((body) => ({
        emailId: body.emailId.toString(),
        runId: args.runId,
        normalizedHtml: body.normalizedHtml ?? null,
        normalizedText: body.normalizedText ?? null,
        links: body.links,
        normalizedAt: body.normalizedAt,
        retentionExpiry: body.retentionExpiry
      }))
    };
  }
});

export const internalCreateRun = internalMutation({
  args: {
    userId: v.string(),
    timeWindowDays: v.number()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      throw new Error('Invalid user id');
    }

    const now = Date.now();
    const runId = await ctx.db.insert('runs', {
      userId,
      status: 'running',
      timeWindowDays: args.timeWindowDays,
      totalMessages: 0,
      processedMessages: 0,
      processedCompanies: 0,
      newslettersClassified: 0,
      costUsd: 0,
      errorCount: 0,
      notes: [],
      startedAt: now,
      updatedAt: now,
      completedAt: undefined,
      failureReason: undefined
    });

    return { runId: runId.toString() };
  }
});

export const internalUpdateRunTotals = internalMutation({
  args: {
    runId: v.string(),
    totalMessages: v.number()
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    await ctx.db.patch(runId, {
      totalMessages: args.totalMessages,
      updatedAt: Date.now()
    });
  }
});

export const internalUpdateRunProgress = internalMutation({
  args: {
    runId: v.string(),
    processedMessages: v.number(),
    newslettersClassified: v.number(),
    processedCompanies: v.optional(v.number()),
    costUsd: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    await ctx.db.patch(runId, {
      processedMessages: args.processedMessages,
      newslettersClassified: args.newslettersClassified,
      processedCompanies: typeof args.processedCompanies === 'number' ? args.processedCompanies : undefined,
      costUsd: typeof args.costUsd === 'number' ? args.costUsd : undefined,
      updatedAt: Date.now()
    });
  }
});

export const internalCompleteRun = internalMutation({
  args: {
    runId: v.string(),
    processedMessages: v.number(),
    newslettersClassified: v.number(),
    processedCompanies: v.number()
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    const now = Date.now();
    await ctx.db.patch(runId, {
      status: 'complete',
      processedMessages: args.processedMessages,
      newslettersClassified: args.newslettersClassified,
      processedCompanies: args.processedCompanies,
      completedAt: now,
      updatedAt: now,
      failureReason: undefined
    });
  }
});

export const internalMarkRunFailed = internalMutation({
  args: {
    runId: v.string(),
    reason: v.string()
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    const now = Date.now();
    await ctx.db.patch(runId, {
      status: 'failed',
      failureReason: args.reason,
      completedAt: now,
      updatedAt: now
    });
  }
});

export const internalLogRunNote = internalMutation({
  args: {
    runId: v.string(),
    code: v.string(),
    message: v.optional(v.string()),
    context: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    const run = await ctx.db.get(runId);
    if (!run) {
      throw new Error(RUN_NOT_FOUND);
    }

    const entry = {
      at: Date.now(),
      code: args.code,
      message: args.message ?? undefined,
      context: args.context ?? undefined
    };

    const notes = Array.isArray(run.notes) ? [...run.notes, entry] : [entry];
    const MAX_NOTES = 20;
    while (notes.length > MAX_NOTES) {
      notes.shift();
    }

    await ctx.db.patch(runId, {
      notes,
      errorCount: (run.errorCount ?? 0) + 1,
      updatedAt: Date.now()
    });
  }
});

export const internalStoreEmailMetadata = internalMutation({
  args: {
    runId: v.string(),
    gmailId: v.string(),
    threadId: v.string(),
    subject: v.string(),
    from: v.string(),
    listId: v.optional(v.string()),
    platform: v.string(),
    sentAt: v.number()
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    if (!runId) {
      throw new Error(RUN_NOT_FOUND);
    }

    const existing = await ctx.db
      .query('emails')
      .withIndex('by_gmail_id', (q) => q.eq('gmailId', args.gmailId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        runId,
        threadId: args.threadId,
        subject: args.subject,
        from: args.from,
        listId: args.listId ?? undefined,
        platform: args.platform,
        sentAt: args.sentAt
      });
      return { emailId: existing._id.toString() };
    }

    const emailId = await ctx.db.insert('emails', {
      runId,
      gmailId: args.gmailId,
      threadId: args.threadId,
      subject: args.subject,
      from: args.from,
      listId: args.listId ?? undefined,
      platform: args.platform,
      sentAt: args.sentAt
    });

    return { emailId: emailId.toString() };
  }
});

export const internalStoreEmailBody = internalMutation({
  args: {
    runId: v.string(),
    emailId: v.string(),
    normalizedHtml: v.optional(v.string()),
    normalizedText: v.optional(v.string()),
    links: v.array(v.string()),
    retentionExpiry: v.number()
  },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId('runs', args.runId);
    const emailId = ctx.db.normalizeId('emails', args.emailId);
    if (!runId || !emailId) {
      throw new Error('Invalid identifiers for email body storage');
    }

    const existing = await ctx.db
      .query('email_bodies')
      .withIndex('by_email', (q) => q.eq('emailId', emailId))
      .unique();

    const doc = {
      emailId,
      runId,
      normalizedHtml: args.normalizedHtml ?? undefined,
      normalizedText: args.normalizedText ?? undefined,
      links: Array.from(new Set(args.links)),
      normalizedAt: Date.now(),
      retentionExpiry: args.retentionExpiry
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert('email_bodies', doc);
    }
  }
});
