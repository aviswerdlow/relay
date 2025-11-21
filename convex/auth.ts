import type { SessionSummary, UserSettings } from '@relay/types';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server.js';
import { v } from 'convex/values';
import type { GenericId } from 'convex/values';
import { hashToken } from './hash.js';
import { sanitizeRetentionDays, sanitizeTimeWindowDays } from './util.js';

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

type UserId = GenericId<'users'>;

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function defaultUserSettings(): UserSettings {
  return {
    timeWindowDays: 90,
    retentionDays: 30
  };
}

interface StoreTokensArgs {
  googleUserId: string;
  email: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiry: number;
  scopes: string[];
  sessionTokenHash: string;
}

interface StoredTokenDoc {
  _id: GenericId<'oauth_tokens'>;
  userId: UserId;
  provider: 'google';
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiry: number;
  scopes: string[];
  updatedAt: number;
}

export const internalStoreGoogleTokens = internalMutation({
  args: {
    googleUserId: v.string(),
    email: v.string(),
    accessTokenEnc: v.string(),
    refreshTokenEnc: v.string(),
    expiry: v.number(),
    scopes: v.array(v.string()),
    sessionTokenHash: v.string()
  },
  handler: async (ctx, args): Promise<SessionSummary> => {
    const now = Date.now();

    let user = await ctx.db
      .query('users')
      .withIndex('by_google_user', (q) => q.eq('googleUserId', args.googleUserId))
      .unique();

    if (!user) {
      const userId = await ctx.db.insert('users', {
        googleUserId: args.googleUserId,
        email: args.email,
        createdAt: now,
        settings: defaultUserSettings()
      });
      user = (await ctx.db.get(userId))!;
    } else if (user.email !== args.email) {
      await ctx.db.patch(user._id, { email: args.email });
      user = (await ctx.db.get(user._id))!;
    }

    const existingTokens = await ctx.db
      .query('oauth_tokens')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique();

    const tokenDoc = {
      userId: user._id,
      provider: 'google' as const,
      accessTokenEnc: args.accessTokenEnc,
      refreshTokenEnc: args.refreshTokenEnc,
      expiry: args.expiry,
      scopes: args.scopes,
      updatedAt: now
    };

    if (existingTokens) {
      await ctx.db.patch(existingTokens._id, tokenDoc);
    } else {
      await ctx.db.insert('oauth_tokens', tokenDoc);
    }

    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    await ctx.db.insert('sessions', {
      userId: user._id,
      tokenHash: args.sessionTokenHash,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS
    });

    return {
      userId: user._id.toString(),
      email: user.email,
      settings: user.settings
    };
  }
});

export const internalGetTokensForUser = internalQuery({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return null;
    }

    return (await ctx.db
      .query('oauth_tokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()) as StoredTokenDoc | null;
  }
});

export const internalRemoveTokens = internalMutation({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return;
    }

    const tokens = await ctx.db
      .query('oauth_tokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    for (const token of tokens) {
      await ctx.db.delete(token._id);
    }
  }
});

export const internalUpdateAccessToken = internalMutation({
  args: {
    userId: v.string(),
    accessTokenEnc: v.string(),
    expiry: v.number()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      throw new Error('User not found for token refresh');
    }

    const tokenDoc = await ctx.db
      .query('oauth_tokens')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    if (!tokenDoc) {
      throw new Error('OAuth tokens missing for user refresh');
    }

    await ctx.db.patch(tokenDoc._id, {
      accessTokenEnc: args.accessTokenEnc,
      expiry: args.expiry,
      updatedAt: Date.now()
    });
  }
});

export const internalClearSessions = internalMutation({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return;
    }

    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
  }
});

export const internalDeleteAllUserData = internalMutation({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return;
    }

    await deleteAllDataForUser(ctx, userId);
  }
});

export async function deleteAllDataForUser(ctx: any, userId: any) {
  const runs = await ctx.db
    .query('runs')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();
  for (const run of runs) {
    const emails = await ctx.db
      .query('emails')
      .withIndex('by_run', (q: any) => q.eq('runId', run._id))
      .collect();
    for (const email of emails) {
      const bodies = await ctx.db
        .query('email_bodies')
        .withIndex('by_run', (q: any) => q.eq('runId', run._id))
        .collect();
      for (const body of bodies) {
        await ctx.db.delete(body._id);
      }
      await ctx.db.delete(email._id);
    }

    const companies = await ctx.db
      .query('companies')
      .withIndex('by_run', (q: any) => q.eq('runId', run._id))
      .collect();
    for (const company of companies) {
      await ctx.db.delete(company._id);
    }

    const links = await ctx.db
      .query('link_metadata')
      .withIndex('by_run', (q: any) => q.eq('runId', run._id))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }

    const exports = await ctx.db
      .query('exports')
      .withIndex('by_run', (q: any) => q.eq('runId', run._id))
      .collect();
    for (const record of exports) {
      await ctx.db.delete(record._id);
    }

    await ctx.db.delete(run._id);
  }

  const sessions = await ctx.db
    .query('sessions')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();
  for (const session of sessions) {
    await ctx.db.delete(session._id);
  }

  const userExports = await ctx.db
    .query('exports')
    .withIndex('by_user', (q: any) => q.eq('userId', userId))
    .collect();
  for (const record of userExports) {
    await ctx.db.delete(record._id);
  }
}

export const getUserSettings = query({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return defaultUserSettings();
    }
    const user = await ctx.db.get(userId);
    return user?.settings ?? defaultUserSettings();
  }
});

export const updateUserSettings = mutation({
  args: {
    userId: v.string(),
    timeWindowDays: v.number(),
    retentionDays: v.number()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      throw new Error('Invalid user id');
    }

    const settings = {
      timeWindowDays: sanitizeTimeWindowDays(args.timeWindowDays),
      retentionDays: sanitizeRetentionDays(args.retentionDays)
    };

    await ctx.db.patch(userId, { settings });
    const user = await ctx.db.get(userId);
    return user?.settings ?? settings;
  }
});

export const internalGetUser = internalQuery({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId('users', args.userId);
    if (!userId) {
      return null;
    }

    return await ctx.db.get(userId);
  }
});

export const deleteAllData = action({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internalRemoveTokens as any, { userId: args.userId });
    await ctx.runMutation(internalDeleteAllUserData as any, { userId: args.userId });
  }
});

export const getSessionFromToken = query({
  args: {
    token: v.string()
  },
  handler: async (ctx, args) => {
    const tokenHash = hashToken(args.token);
    const session = await ctx.db
      .query('sessions')
      .withIndex('by_token', (q) => q.eq('tokenHash', tokenHash))
      .unique();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    const user = await ctx.db.get(session.userId);
    if (!user) {
      return null;
    }

    const summary: SessionSummary = {
      userId: session.userId.toString(),
      email: user.email,
      settings: user.settings
    };

    return summary;
  }
});
