import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { exchangeOAuthCodeViaConvex } from '$lib/server/convex';
import { getGoogleOAuthConfig, isProduction } from '$lib/server/env';

const STATE_COOKIE = 'relay_oauth_state';
const SESSION_COOKIE = 'relay_session_token';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const returnedState = url.searchParams.get('state');
	const storedState = cookies.get(STATE_COOKIE);

	if (!returnedState || !storedState || returnedState !== storedState) {
		throw error(400, 'OAuth state mismatch. Please restart the sign-in flow.');
	}

	const code = url.searchParams.get('code');
	const errorParam = url.searchParams.get('error');

	cookies.delete(STATE_COOKIE, { path: '/' });

	if (errorParam) {
		throw error(400, `Google OAuth error: ${errorParam}`);
	}
	if (!code) {
		throw error(400, 'Missing authorization code from Google.');
	}

	const { redirectUri } = getGoogleOAuthConfig();

	let session;
	try {
		session = await exchangeOAuthCodeViaConvex(code, redirectUri);
	} catch (err) {
		console.error('Failed to exchange OAuth code', err);
		throw error(502, 'Unable to sign in with Google. Check server logs for details.');
	}

	if (!session.convexAuthToken) {
		throw error(500, 'Convex did not return a session token.');
	}

	cookies.set(SESSION_COOKIE, session.convexAuthToken, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: isProduction,
		maxAge: 60 * 60 * 24 * 7
	});

	throw redirect(302, '/');
};
