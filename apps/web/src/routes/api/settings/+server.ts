import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSettingsViaConvex, updateSettingsViaConvex } from '$lib/server/convex';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.session) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await getSettingsViaConvex(locals.session.userId);
  return json({ settings });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.session) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const timeWindowDays = Number(body?.timeWindowDays);
  const retentionDays = Number(body?.retentionDays);

  if (!Number.isFinite(timeWindowDays) || !Number.isFinite(retentionDays)) {
    return json({ error: 'Invalid payload' }, { status: 400 });
  }

  const settings = await updateSettingsViaConvex(locals.session.userId, {
    timeWindowDays,
    retentionDays
  });
  return json({ settings });
};
