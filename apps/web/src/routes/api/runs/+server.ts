import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listRunsViaConvex } from '$lib/server/convex';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Number.parseInt(limitParam, 10) : 10;

	try {
		const runs = await listRunsViaConvex(locals.session.userId, Number.isFinite(limit) ? limit : 10);
		return json({ runs });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[api/runs] list failed', { userId: locals.session.userId, message });
		return json({ error: 'Failed to list runs' }, { status: 500 });
	}
};
