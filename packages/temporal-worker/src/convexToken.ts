import { requireEnv } from './env';

// For now reuse deploy key as admin key; replace with auth service if needed.
let cachedToken: string | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const token = requireEnv('CONVEX_DEPLOY_KEY');
  cachedToken = token;
  return token;
}
