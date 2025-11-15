import type { Handle } from '@sveltejs/kit';
import { fetchSessionSummary } from '$lib/server/convex';

const SESSION_COOKIE = 'relay_session_token';

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.session = null;

	if (token) {
		try {
			const summary = await fetchSessionSummary(token);
			if (summary) {
				event.locals.session = summary;
			} else {
				event.cookies.delete(SESSION_COOKIE, { path: '/' });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('PUBLIC_CONVEX_URL is not configured')) {
				// Skip logging during early setup; the user hasn't configured Convex yet.
			} else {
				console.error('Failed to load Convex session', err);
			}
		}
	}

	return resolve(event);
};
