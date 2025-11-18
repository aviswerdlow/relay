import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Convex data model sketch following docs/TDD.md.
 * Field shapes will be tightened in follow-up issues.
 */
export default defineSchema({
  users: defineTable({
    googleUserId: v.string(),
    email: v.string(),
    createdAt: v.number(),
    settings: v.object({
      timeWindowDays: v.number(),
      retentionDays: v.number()
    })
  })
    .index('by_google_user', ['googleUserId'])
    .index('by_email', ['email']),

  oauth_tokens: defineTable({
    userId: v.id('users'),
    provider: v.literal('google'),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.string(),
    expiry: v.number(),
    scopes: v.array(v.string()),
    updatedAt: v.number()
  }).index('by_user', ['userId']),

  runs: defineTable({
    userId: v.id('users'),
    status: v.string(),
    timeWindowDays: v.number(),
    totalMessages: v.number(),
    processedMessages: v.number(),
    processedCompanies: v.number(),
    newslettersClassified: v.number(),
    costUsd: v.number(),
    errorCount: v.number(),
    notes: v.array(
      v.object({
        at: v.number(),
        code: v.string(),
        message: v.optional(v.string()),
        context: v.optional(v.string())
      })
    ),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    failureReason: v.optional(v.string())
  })
    .index('by_user', ['userId'])
    .index('by_status', ['status', 'userId']),

  emails: defineTable({
    runId: v.id('runs'),
    gmailId: v.string(),
    threadId: v.string(),
    subject: v.string(),
    from: v.string(),
    listId: v.optional(v.string()),
    platform: v.string(),
    sentAt: v.number()
  })
    .index('by_run', ['runId'])
    .index('by_gmail_id', ['gmailId']),

  email_bodies: defineTable({
    emailId: v.id('emails'),
    runId: v.id('runs'),
    normalizedHtml: v.optional(v.string()),
    normalizedText: v.optional(v.string()),
    links: v.array(v.string()),
    normalizedAt: v.number(),
    retentionExpiry: v.number()
  })
    .index('by_email', ['emailId'])
    .index('by_run', ['runId'])
    .index('by_retention', ['retentionExpiry']),

  companies: defineTable({
    runId: v.id('runs'),
    userId: v.id('users'),
    name: v.string(),
    homepageUrl: v.optional(v.string()),
    altDomains: v.array(v.string()),
    oneLineSummary: v.string(),
    category: v.string(),
    stage: v.string(),
    location: v.optional(v.string()),
    platform: v.optional(v.string()),
    keySignals: v.array(v.string()),
    sourceEmailIds: v.array(v.string()),
    snippets: v.array(
      v.object({
        quote: v.string(),
        start: v.optional(v.number()),
        end: v.optional(v.number())
      })
    ),
    confidence: v.number(),
    decision: v.string(),
    score: v.number(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    canonicalDomain: v.string(),
    normalizedName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number()
  })
    .index('by_user', ['userId'])
    .index('by_run', ['runId'])
    .index('by_domain', ['userId', 'canonicalDomain'])
    .index('by_normalized_name', ['userId', 'normalizedName']),

  link_metadata: defineTable({
    runId: v.id('runs'),
    url: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    canonicalUrl: v.optional(v.string()),
    socialLinks: v.array(v.string()),
    fetchedAt: v.number()
  })
    .index('by_run', ['runId'])
    .index('by_url', ['url']),

  exports: defineTable({
    runId: v.optional(v.id('runs')),
    userId: v.id('users'),
    status: v.string(),
    filename: v.string(),
    url: v.optional(v.string()),
    requestedAt: v.number(),
    availableAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    failureReason: v.optional(v.string())
  })
    .index('by_user', ['userId'])
    .index('by_run', ['runId']),

  sessions: defineTable({
    userId: v.id('users'),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number()
  })
    .index('by_token', ['tokenHash'])
    .index('by_user', ['userId'])
});
