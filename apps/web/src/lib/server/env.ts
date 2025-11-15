import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export interface GoogleOAuthConfig {
	clientId: string;
	redirectUri: string;
	scopes: string[];
}

function requirePrivateEnv(name: string): string {
	const value = privateEnv[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
	const scopesRaw =
		privateEnv.GOOGLE_OAUTH_SCOPES ??
		'openid email profile https://www.googleapis.com/auth/gmail.readonly';

	return {
		clientId: requirePrivateEnv('GOOGLE_CLIENT_ID'),
		redirectUri: requirePrivateEnv('GOOGLE_OAUTH_REDIRECT_URI'),
		scopes: scopesRaw.split(/\s+/).filter(Boolean)
	};
}

export function getConvexUrl(): string {
	const url = publicEnv.PUBLIC_CONVEX_URL;
	if (!url) {
		throw new Error('PUBLIC_CONVEX_URL is not configured. Set it in your env file.');
	}
	return url;
}

export const isProduction = privateEnv.NODE_ENV === 'production';
