import type { NewsletterPlatform } from '@relay/types';
import { classifyNewsletterFromMetadata, refinePlatformWithBody } from './gmail.js';
import { normalizeMessageBody, type NormalizedMessage } from './nlp.js';

export interface MessageCandidate {
  id: string;
  threadId: string;
}

export interface MessageMetadata {
  gmailId: string;
  threadId: string;
  subject: string;
  from: string;
  listId: string | null | undefined;
  sentAt: number;
}

export interface ScanPipelineDeps {
  listMessages: () => Promise<MessageCandidate[]>;
  fetchMetadata: (gmailId: string) => Promise<MessageMetadata | null>;
  fetchFullMessage: (gmailId: string) => Promise<any | null>;
  storeEmailMetadata: (input: {
    runId: string;
    gmailId: string;
    threadId: string;
    subject: string;
    from: string;
    listId?: string;
    platform: NewsletterPlatform;
    sentAt: number;
  }) => Promise<{ emailId: string }>;
  storeEmailBody: (input: {
    runId: string;
    emailId: string;
    normalized: NormalizedMessage;
    retentionExpiry: number;
  }) => Promise<void>;
  extractCompanies: (input: {
    runId: string;
    userId: string;
    emailId: string;
    gmailId: string;
    metadata: {
      subject: string;
      listId: string | null;
      from: string;
      sentAt: number;
      platform?: string;
    };
    normalized: NormalizedMessage;
    platform?: string;
  }) => Promise<{ created: number; costUsd: number } | null>;
  updateProgress: (input: {
    processedMessages: number;
    newslettersClassified: number;
    processedCompanies: number;
    costUsd: number;
  }) => Promise<void>;
  markFailed: (reason: string) => Promise<void>;
  completeRun: (input: {
    processedMessages: number;
    newslettersClassified: number;
    processedCompanies: number;
  }) => Promise<void>;
  setTotals: (totalMessages: number) => Promise<void>;
  logError: (code: string, message?: string, context?: Record<string, unknown>) => Promise<void>;
  logInfo?: (code: string, context?: Record<string, unknown>) => Promise<void>;
}

export interface ScanPipelineConfig {
  runId: string;
  userId: string;
  costCapUsd: number;
  retentionExpiry: number;
  unknownPlatformLogLimit?: number;
}

export interface ScanPipelineResult {
  processedMessages: number;
  newslettersClassified: number;
  processedCompanies: number;
  totalCostUsd: number;
  abortedByBudget: boolean;
}

export async function runScanPipeline(
  config: ScanPipelineConfig,
  deps: ScanPipelineDeps
): Promise<ScanPipelineResult> {
  const messages = await deps.listMessages();
  await deps.setTotals(messages.length);

  let processed = 0;
  let classified = 0;
  let companies = 0;
  let totalCostUsd = 0;
  let abortedByBudget = false;
  let loggedUnknownPlatforms = 0;
  const unknownLimit = config.unknownPlatformLogLimit ?? 0;

  for (const message of messages) {
    processed += 1;

    const pushProgress = async () => {
      await deps.updateProgress({
        processedMessages: processed,
        newslettersClassified: classified,
        processedCompanies: companies,
        costUsd: Number(totalCostUsd.toFixed(4))
      });
    };

    let metadata: MessageMetadata | null = null;
    try {
      metadata = await deps.fetchMetadata(message.id);
    } catch (error) {
      await deps.logError('gmail_metadata_failed', formatErrorMessage(error), { gmailId: message.id });
      await pushProgress();
      continue;
    }
    if (!metadata) {
      await deps.logError('gmail_metadata_missing', 'Metadata not found', { gmailId: message.id });
      await pushProgress();
      continue;
    }

    let normalized: NormalizedMessage | null = null;
    try {
      const full = await deps.fetchFullMessage(message.id);
      if (full?.payload) {
        normalized = normalizeMessageBody(full.payload);
      }
    } catch (error) {
      await deps.logError('gmail_body_failed', formatErrorMessage(error), { gmailId: message.id });
      await pushProgress();
      continue;
    }
    if (!normalized) {
      await deps.logError('gmail_body_missing', 'Body not found', { gmailId: message.id });
      await pushProgress();
      continue;
    }

    const platformGuess = classifyNewsletterFromMetadata({
      from: metadata.from,
      listId: metadata.listId ?? null,
      subject: metadata.subject ?? undefined
    });
    const refinedPlatform = refinePlatformWithBody(normalized.html ?? normalized.text ?? null, platformGuess);
    if (refinedPlatform === 'unknown' && deps.logInfo && loggedUnknownPlatforms < unknownLimit) {
      await deps.logInfo('scan:processing_unknown_platform', { runId: config.runId, gmailId: metadata.gmailId });
      loggedUnknownPlatforms += 1;
    }

    const { emailId } = await deps.storeEmailMetadata({
      runId: config.runId,
      gmailId: metadata.gmailId,
      threadId: metadata.threadId,
      subject: metadata.subject ?? '',
      from: metadata.from,
      listId: metadata.listId ?? undefined,
      platform: refinedPlatform as NewsletterPlatform,
      sentAt: metadata.sentAt
    });

    await deps.storeEmailBody({
      runId: config.runId,
      emailId,
      normalized,
      retentionExpiry: config.retentionExpiry
    });

    const extraction = await deps.extractCompanies({
      runId: config.runId,
      userId: config.userId,
      emailId,
      gmailId: metadata.gmailId,
      metadata: {
        subject: metadata.subject,
        listId: metadata.listId ?? null,
        from: metadata.from,
        sentAt: metadata.sentAt,
        platform: refinedPlatform
      },
      normalized,
      platform: refinedPlatform
    });

    if (extraction) {
      companies += extraction.created;
      classified += 1;
      totalCostUsd += extraction.costUsd ?? 0;
      await pushProgress();
    }

    if (totalCostUsd >= config.costCapUsd) {
      abortedByBudget = true;
      const spent = Number(totalCostUsd.toFixed(4));
      const reason = `Scan aborted: estimated OpenAI spend $${spent.toFixed(2)} exceeded $${config.costCapUsd.toFixed(
        2
      )} limit`;
      await deps.logError('cost_cap_exceeded', reason, { spentUsd: spent, capUsd: config.costCapUsd });
      await deps.markFailed(reason);
      break;
    }
  }

  if (!abortedByBudget) {
    await deps.completeRun({
      processedMessages: processed,
      newslettersClassified: classified,
      processedCompanies: companies
    });
  }

  return {
    processedMessages: processed,
    newslettersClassified: classified,
    processedCompanies: companies,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    abortedByBudget
  };
}

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}
