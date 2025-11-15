import { ConvexHttpClient } from 'convex/browser';
import type {
	CompanyRecord,
	EmailBody,
	EmailMetadata,
	ExportMetadata,
	ScanProgress,
	SessionSummary,
	UserSettings
} from '@relay/types';
import { getConvexUrl } from './env';

let client: ConvexHttpClient | null = null;
let cachedUrl: string | null = null;

function ensureClient(): ConvexHttpClient {
	const url = getConvexUrl();
	if (!client || cachedUrl !== url) {
		client = new ConvexHttpClient(url);
		cachedUrl = url;
	}
	return client;
}

export async function exchangeOAuthCodeViaConvex(code: string, redirectUri: string): Promise<SessionSummary> {
	return callAction<SessionSummary>('authActions:exchangeOAuthCode', { code, redirectUri });
}

export async function disconnectGoogleViaConvex(userId: string): Promise<void> {
	await callAction('authActions:disconnectGoogle', { userId });
}

export async function deleteUserDataViaConvex(userId: string): Promise<void> {
	await callAction('auth:deleteAllData', { userId });
}

export async function fetchSessionSummary(token: string): Promise<SessionSummary | null> {
	const summary = await callQuery<SessionSummary | null>('auth:getSessionFromToken', { token });
	if (!summary) {
		return null;
	}
	return {
		...summary,
		convexAuthToken: token
	};
}

export async function startScanViaConvex(userId: string, timeWindowDays?: number): Promise<{ runId: string }> {
	const payload: Record<string, unknown> = { userId };
	if (typeof timeWindowDays === 'number') {
		payload.timeWindowDays = timeWindowDays;
	}
	return callAction<{ runId: string }>('scanActions:startScan', payload);
}

export async function getScanProgressViaConvex(runId: string): Promise<ScanProgress> {
	return callQuery<ScanProgress>('scan:getScanProgress', { runId });
}

export async function listEmailsForRunViaConvex(
	runId: string
): Promise<{ metadata: EmailMetadata[]; bodies: EmailBody[] }> {
	return callQuery<{ metadata: EmailMetadata[]; bodies: EmailBody[] }>('scan:listEmailsForRun', { runId });
}

export async function listCompaniesViaConvex(
	userId: string,
	params: { decision?: string; runId?: string; categories?: string[]; stages?: string[]; platforms?: string[] } = {}
): Promise<CompanyRecord[]> {
	const payload: Record<string, unknown> = { userId };
	if (params.decision) payload.decision = params.decision;
	if (params.runId) payload.runId = params.runId;
	if (params.categories) payload.categories = params.categories;
	if (params.stages) payload.stages = params.stages;
	if (params.platforms) payload.platforms = params.platforms;
	return callQuery<CompanyRecord[]>('companies:listCompanies', payload);
}

export async function requestExportViaConvex(
	userId: string,
	params: { decision?: string; runId?: string } = {}
): Promise<ExportMetadata> {
	const payload: Record<string, unknown> = { userId };
	if (params.decision) payload.decision = params.decision;
	if (params.runId) payload.runId = params.runId;
	return callAction<ExportMetadata>('export:requestExport', payload);
}

export async function getSettingsViaConvex(userId: string): Promise<UserSettings> {
	return callQuery<UserSettings>('auth:getUserSettings', { userId });
}

export async function updateSettingsViaConvex(
	userId: string,
	settings: { timeWindowDays: number; retentionDays: number }
): Promise<UserSettings> {
	return callMutation<UserSettings>('auth:updateUserSettings', {
		userId,
		timeWindowDays: settings.timeWindowDays,
		retentionDays: settings.retentionDays
	});
}

export async function updateCompanyDecisionViaConvex(companyId: string, decision: string): Promise<void> {
	await callMutation('companies:setCompanyDecision', { companyId, decision });
}

async function callAction<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const convex = ensureClient();
	return (await convex.action(name as any, args)) as T;
}

async function callQuery<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const convex = ensureClient();
	return (await convex.query(name as any, args)) as T;
}

async function callMutation<T>(name: string, args: Record<string, unknown>): Promise<T> {
	const convex = ensureClient();
	return (await convex.mutation(name as any, args)) as T;
}
