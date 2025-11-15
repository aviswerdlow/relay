import { internalMutation } from './_generated/server';
import { isExpired } from './util';

export const purgeExpiredEmailBodies = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    while (true) {
      const expired = await ctx.db
        .query('email_bodies')
        .withIndex('by_retention', (q) => q.lt('retentionExpiry', now))
        .take(64);

      if (expired.length === 0) break;

      for (const body of expired) {
        if (!isExpired(body.retentionExpiry, now)) continue;
        await ctx.db.delete(body._id);
      }
    }
  }
});
