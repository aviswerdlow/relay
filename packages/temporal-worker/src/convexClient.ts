import { ConvexHttpClient } from 'convex/browser';
import { requireEnv } from './env.js';
import type { Id } from './types.js';

export function createConvexClient(): { convex: ConvexHttpClient } {
  const url = requireEnv('CONVEX_URL');
  const client = new ConvexHttpClient(url);
  const token = requireEnv('CONVEX_DEPLOY_KEY');
  // Use admin auth because deploy keys are not JWTs
  (client as any).setAdminAuth(token);
  return { convex: client };
}

export async function callMutation<T>(
  client: ConvexHttpClient,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return (await client.mutation(name as any, args)) as T;
}

export async function callQuery<T>(
  client: ConvexHttpClient,
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  return (await client.query(name as any, args)) as T;
}

export type ConvexId<TableName extends string> = Id<TableName>;
