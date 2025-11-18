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

	const userId = locals.session.userId;
	console.log('[api/scan] start requested', { userId, timeWindowDays });

	try {
		const { runId } = await startScanViaConvex(userId, timeWindowDays);
		console.log('[api/scan] start succeeded', { userId, runId });
		return json({ runId });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[api/scan] start failed', { userId, message });
		return json({ error: 'Failed to start scan' }, { status: 500 });
	}
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

	const userId = locals.session.userId;
	console.log('[api/scan] progress requested', { userId, runId, includeEmails });

	try {
		const progress = await getScanProgressViaConvex(runId);

		if (!includeEmails) {
			console.log('[api/scan] progress fetched', {
				userId,
				runId,
				processed: progress.processedMessages,
				classified: progress.newslettersClassified
			});
			return json({ progress });
		}

		const emails = await listEmailsForRunViaConvex(runId);
		console.log('[api/scan] progress + emails fetched', {
			userId,
			runId,
			emailCount: emails.metadata.length
		});
		return json({ progress, emails });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[api/scan] progress failed', { userId, runId, message });
		return json({ error: 'Failed to fetch progress' }, { status: 500 });
	}
};
