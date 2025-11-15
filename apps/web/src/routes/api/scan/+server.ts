import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getScanProgressViaConvex,
	listEmailsForRunViaConvex,
	startScanViaConvex
} from '$lib/server/convex';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const timeWindowDays =
		typeof body?.timeWindowDays === 'number' ? Math.floor(body.timeWindowDays) : undefined;

	const { runId } = await startScanViaConvex(locals.session.userId, timeWindowDays);
	return json({ runId });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const runId = url.searchParams.get('runId');
	const includeEmails = url.searchParams.get('includeEmails') === 'true';

	if (!runId) {
		return json({ error: 'runId is required' }, { status: 400 });
	}

	const progress = await getScanProgressViaConvex(runId);

	if (!includeEmails) {
		return json({ progress });
	}

	const emails = await listEmailsForRunViaConvex(runId);
	return json({ progress, emails });
};
