import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requestExportViaConvex } from '$lib/server/convex';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const decision = typeof body?.decision === 'string' ? body.decision : undefined;
	const runId = typeof body?.runId === 'string' ? body.runId : undefined;

	const exportMeta = await requestExportViaConvex(locals.session.userId, { decision, runId });
	return json({ export: exportMeta });
};
