export interface BackoffOptions {
  retries: number;
  initialDelayMs: number;
  multiplier?: number;
}

/**
 * TODO(#3): Use for Gmail API rate limiting and link fetch retries.
 */
export async function retryWithBackoff<T>(operation: () => Promise<T>, options: BackoffOptions): Promise<T> {
  const { retries, initialDelayMs, multiplier = 2 } = options;
  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
      delay *= multiplier;
    }
  }
}

export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function parseScopes(scopes: string | string[] | undefined): string[] {
  if (!scopes) {
    return [];
  }
  if (Array.isArray(scopes)) {
    return scopes.flatMap((scope) => scope.split(/\s+/).filter(Boolean));
  }
  return scopes.split(/\s+/).filter(Boolean);
}

export function assertRequiredScopes(scopes: string[], required: string[]): void {
  const present = new Set(scopes);
  const missing = required.filter((scope) => !present.has(scope));
  if (missing.length > 0) {
    throw new Error(`Missing required Google OAuth scopes: ${missing.join(', ')}`);
  }
}

export function sanitizeTimeWindowDays(value: number): number {
  return clampNumber(Math.round(value), 7, 365);
}

export function sanitizeRetentionDays(value: number): number {
  return clampNumber(Math.round(value), 7, 365);
}

export function isExpired(retentionExpiry: number, now: number = Date.now()): boolean {
  return retentionExpiry <= now;
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}
