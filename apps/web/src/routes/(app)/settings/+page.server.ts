import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSettingsViaConvex } from '$lib/server/convex';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) {
    throw redirect(302, '/');
  }

  const settings = await getSettingsViaConvex(locals.session.userId);
  return { settings };
};
