'use node';

import { action } from './_generated/server.js';
import { internal } from './_generated/api.js';
import { v } from 'convex/values';
import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  internalClearSessions,
  internalGetTokensForUser,
  internalRemoveTokens,
  internalStoreGoogleTokens
} from './auth.js';
import { assertRequiredScopes, getRequiredEnvVar, parseScopes } from './util.js';
import { deriveAesKey, encryptSecret, decryptSecret, generateSessionToken } from './crypto.js';
import { hashToken } from './hash.js';

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

export const exchangeOAuthCode = action({
  args: {
    code: v.string(),
    redirectUri: v.string()
  },
  handler: async (ctx, args) => {
    const clientId = getRequiredEnvVar('GOOGLE_CLIENT_ID');
    const clientSecret = getRequiredEnvVar('GOOGLE_CLIENT_SECRET');
    const encryptionKey = deriveAesKey(getRequiredEnvVar('TOKEN_ENCRYPTION_SECRET'));
    const scopesFromEnv = parseScopes(process.env.GOOGLE_OAUTH_SCOPES);

    const tokenResponse = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: args.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: args.redirectUri,
        grant_type: 'authorization_code',
        access_type: 'offline',
        prompt: 'consent'
      })
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      throw new Error(`Failed to exchange OAuth code: ${tokenResponse.status} ${errorBody}`);
    }

    const tokenPayload = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
    };

    const scopes = parseScopes(tokenPayload.scope ?? scopesFromEnv);
    assertRequiredScopes(scopes, REQUIRED_SCOPES);
    if (!scopes.includes('openid')) {
      console.warn('Google OAuth did not include openid scope; proceeding without it.');
    }

    const accessToken = tokenPayload.access_token;
    const refreshToken = tokenPayload.refresh_token;

    if (!refreshToken) {
      throw new Error('Google did not return a refresh token. Ensure access_type=offline and prompt=consent.');
    }

    const userInfoResponse = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userInfoResponse.ok) {
      const errorBody = await userInfoResponse.text();
      throw new Error(`Failed to fetch Google user info: ${userInfoResponse.status} ${errorBody}`);
    }

    const userInfo = (await userInfoResponse.json()) as { sub: string; email: string };
    const expiresInSeconds = tokenPayload.expires_in ?? 3600;

    const sessionToken = generateSessionToken();

    const sessionSummary = await ctx.runMutation(internal.auth.internalStoreGoogleTokens, {
      googleUserId: userInfo.sub,
      email: userInfo.email,
      accessTokenEnc: encryptSecret(accessToken, encryptionKey),
      refreshTokenEnc: encryptSecret(refreshToken, encryptionKey),
      expiry: Date.now() + expiresInSeconds * 1000,
      scopes,
      sessionTokenHash: hashToken(sessionToken)
    });

    return {
      ...sessionSummary,
      convexAuthToken: sessionToken
    };
  }
});

export const disconnectGoogle = action({
  args: {
    userId: v.string()
  },
  handler: async (ctx, args) => {
    const tokenDoc = await ctx.runQuery(internal.auth.internalGetTokensForUser, { userId: args.userId });
    if (tokenDoc) {
      try {
        const encryptionKey = deriveAesKey(getRequiredEnvVar('TOKEN_ENCRYPTION_SECRET'));
        const refreshToken = decryptSecret(tokenDoc.refreshTokenEnc, encryptionKey);
        const revokeResponse = await fetch(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: refreshToken,
            client_id: getRequiredEnvVar('GOOGLE_CLIENT_ID'),
            client_secret: getRequiredEnvVar('GOOGLE_CLIENT_SECRET')
          })
        });

        if (!revokeResponse.ok) {
          const text = await revokeResponse.text();
          console.warn(`Google token revocation produced status ${revokeResponse.status}: ${text}`);
        }
      } catch (error) {
        console.warn('Failed to revoke Google token', error);
      }
    }

    await ctx.runMutation(internal.auth.internalRemoveTokens, { userId: args.userId });
    await ctx.runMutation(internal.auth.internalClearSessions, { userId: args.userId });
  }
});
