import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || undefined });

export const env = {
  TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  TEMPORAL_NAMESPACE: process.env.TEMPORAL_NAMESPACE ?? 'default',
  TEMPORAL_TASK_QUEUE: process.env.TEMPORAL_TASK_QUEUE ?? 'relay-scan',
  TEMPORAL_API_KEY: process.env.TEMPORAL_API_KEY ?? '',
  CONVEX_URL: process.env.CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL ?? '',
  CONVEX_DEPLOY_KEY: process.env.CONVEX_DEPLOY_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  TOKEN_ENCRYPTION_SECRET: process.env.TOKEN_ENCRYPTION_SECRET ?? '',
  TEMPORAL_TLS_CERT_PATH: process.env.TEMPORAL_TLS_CERT_PATH ?? '',
  TEMPORAL_TLS_KEY_PATH: process.env.TEMPORAL_TLS_KEY_PATH ?? '',
  TEMPORAL_TLS_CA_PATH: process.env.TEMPORAL_TLS_CA_PATH ?? '',
  TEMPORAL_TLS_SERVER_NAME: process.env.TEMPORAL_TLS_SERVER_NAME ?? ''
};

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
