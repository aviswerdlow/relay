import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCompaniesViaConvex, updateCompanyDecisionViaConvex } from '$lib/server/convex';

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const decision = url.searchParams.get('decision') ?? undefined;
	const runId = url.searchParams.get('runId') ?? undefined;
	const categories = url.searchParams.get('categories');
	const stages = url.searchParams.get('stages');
	const platforms = url.searchParams.get('platforms');

	const companies = await listCompaniesViaConvex(locals.session.userId, {
		decision,
		runId,
		categories: categories ? categories.split(',').filter(Boolean) : undefined,
		stages: stages ? stages.split(',').filter(Boolean) : undefined,
		platforms: platforms ? platforms.split(',').filter(Boolean) : undefined
	});
	return json({ companies });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const companyId = body?.companyId;
	const decision = body?.decision;

	if (typeof companyId !== 'string' || typeof decision !== 'string') {
		return json({ error: 'Invalid payload' }, { status: 400 });
	}

	await updateCompanyDecisionViaConvex(companyId, decision);
	return json({ ok: true });
};
