import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.daily('purgeExpiredEmailBodies', { hourUTC: 3, minuteUTC: 0 }, internal.purge.purgeExpiredEmailBodies);

export default crons;
