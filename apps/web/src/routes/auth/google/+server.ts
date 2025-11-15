import { randomBytes } from 'node:crypto';
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { getGoogleOAuthConfig, isProduction } from '$lib/server/env';

const STATE_COOKIE = 'relay_oauth_state';

export const GET: RequestHandler = async ({ cookies }) => {
	const { clientId, redirectUri, scopes } = getGoogleOAuthConfig();
	const state = randomBytes(16).toString('hex');

	cookies.set(STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isProduction,
		maxAge: 600
	});

	const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
	authUrl.searchParams.set('client_id', clientId);
	authUrl.searchParams.set('redirect_uri', redirectUri);
	authUrl.searchParams.set('response_type', 'code');
	authUrl.searchParams.set('scope', scopes.join(' '));
	authUrl.searchParams.set('access_type', 'offline');
	authUrl.searchParams.set('prompt', 'consent');
	authUrl.searchParams.set('state', state);

	throw redirect(302, authUrl.toString());
};
