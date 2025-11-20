import { proxyActivities } from '@temporalio/workflow';
import type { NormalizedMessage } from '../../../../convex/nlp';
import type { NewsletterPlatform } from '@relay/types';

const { scanEmail } = proxyActivities<{
  scanEmail(input: {
    runId: string;
    userId: string;
    retentionExpiry: number;
    timeWindowDays?: number;
    unknownPlatformLogLimit?: number;
  }): Promise<{
    processedMessages: number;
    newslettersClassified: number;
    processedCompanies: number;
    totalCostUsd: number;
    abortedByBudget: boolean;
  }>;
}>({
  startToCloseTimeout: '30 minutes',
  heartbeatTimeout: '1 minute'
});

export async function startScanWorkflow(params: {
  runId: string;
  userId: string;
  retentionExpiry: number;
  timeWindowDays?: number;
  unknownPlatformLogLimit?: number;
}): Promise<{
  processedMessages: number;
  newslettersClassified: number;
  processedCompanies: number;
  totalCostUsd: number;
  abortedByBudget: boolean;
}> {
  return await scanEmail({
    runId: params.runId,
    userId: params.userId,
    retentionExpiry: params.retentionExpiry,
    timeWindowDays: params.timeWindowDays,
    unknownPlatformLogLimit: params.unknownPlatformLogLimit
  });
}
