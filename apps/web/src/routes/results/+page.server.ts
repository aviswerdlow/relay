import type { PageServerLoad } from './$types';
import { listCompaniesViaConvex } from '$lib/server/convex';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.session) {
		return {
			companies: []
		};
	}

	const companies = await listCompaniesViaConvex(locals.session.userId);
	return { companies, session: locals.session };
};
