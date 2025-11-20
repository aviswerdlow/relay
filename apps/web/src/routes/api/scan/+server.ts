import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enqueueScanViaConvex, getScanProgressViaConvex, listEmailsForRunViaConvex } from '$lib/server/convex';
import { getTemporalClient, getTemporalTaskQueue } from '$lib/server/temporal';

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
		const { runId, timeWindowDays: scheduledWindow, retentionDays } = await enqueueScanViaConvex(
			userId,
			timeWindowDays
		);

		const client = await getTemporalClient();
		const taskQueue = getTemporalTaskQueue();
		const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
		const retentionExpiry = Date.now() + retentionMs;

		const handle = await client.workflow.start('startScanWorkflow', {
			args: [{ runId, userId, timeWindowDays: scheduledWindow, retentionExpiry }],
			taskQueue,
			workflowId: runId // correlate workflow to run
		});

		console.log('[api/scan] start succeeded', { userId, runId, workflowId: handle.workflowId });
		return json({ runId, workflowId: handle.workflowId }, { status: 202 });
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
		const summary = {
			status: progress.status,
			totalMessages: progress.totalMessages,
			processedMessages: progress.processedMessages,
			newslettersClassified: progress.newslettersClassified,
			processedCompanies: progress.processedCompanies,
			costUsd: progress.costUsd,
			errorCount: progress.errorCount,
			recentErrors: (progress.recentErrors ?? []).length,
			failureReason: progress.failureReason
		};

		if (!includeEmails) {
			console.log('[api/scan] progress fetched', {
				userId,
				runId,
				...summary
			});
			return json({ progress });
		}

		const emails = await listEmailsForRunViaConvex(runId);
		console.log('[api/scan] progress + emails fetched', {
			userId,
			runId,
			metadataCount: emails.metadata.length,
			bodyCount: emails.bodies.length,
			...summary
		});
		return json({ progress, emails });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('[api/scan] progress failed', { userId, runId, message });
		return json({ error: 'Failed to fetch progress' }, { status: 500 });
	}
};
