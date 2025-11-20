import { describe, expect, it, vi } from 'vitest';
import { runScanPipeline } from '../scanPipeline';
import type { NormalizedMessage } from '../nlp';

const normalized: NormalizedMessage = { html: null, text: '<p>hello</p>', links: [] };

function baseDeps() {
  const logError = vi.fn();
  const setTotals = vi.fn();
  const updateProgress = vi.fn();
  const markFailed = vi.fn();
  const completeRun = vi.fn();
  const storeEmailMetadata = vi.fn().mockResolvedValue({ emailId: 'email-1' });
  const storeEmailBody = vi.fn();
  const extractCompanies = vi.fn().mockResolvedValue({ created: 1, costUsd: 0.2 });

  return {
    deps: {
      listMessages: vi.fn().mockResolvedValue([{ id: 'g1', threadId: 't1' }]),
      fetchMetadata: vi.fn().mockResolvedValue({
        gmailId: 'g1',
        threadId: 't1',
        subject: 'Hello',
        from: 'news@substackmail.com',
        listId: 'list',
        sentAt: Date.now()
      }),
      fetchFullMessage: vi.fn().mockResolvedValue({ payload: { body: { data: Buffer.from('Hello').toString('base64') } } }),
      storeEmailMetadata,
      storeEmailBody,
      extractCompanies,
      updateProgress,
      markFailed,
      completeRun,
      setTotals,
      logError,
      logInfo: vi.fn()
    },
    fns: { logError, setTotals, updateProgress, markFailed, completeRun, extractCompanies, storeEmailMetadata, storeEmailBody }
  };
}

describe('runScanPipeline', () => {
  it('runs happy path and completes', async () => {
    const { deps, fns } = baseDeps();
    const result = await runScanPipeline(
      {
        runId: 'run-1',
        userId: 'user-1',
        costCapUsd: 5,
        retentionExpiry: Date.now() + 1000
      },
      deps
    );

    expect(fns.setTotals).toHaveBeenCalledWith(1);
    expect(fns.storeEmailMetadata).toHaveBeenCalledTimes(1);
    expect(fns.storeEmailBody).toHaveBeenCalledTimes(1);
    expect(fns.extractCompanies).toHaveBeenCalledTimes(1);
    expect(fns.completeRun).toHaveBeenCalledTimes(1);
    expect(result.processedMessages).toBe(1);
    expect(result.newslettersClassified).toBe(1);
    expect(result.processedCompanies).toBe(1);
    expect(result.abortedByBudget).toBe(false);
  });

  it('logs metadata error and continues', async () => {
    const { deps, fns } = baseDeps();
    deps.fetchMetadata = vi.fn().mockRejectedValue(new Error('meta fail'));

    const result = await runScanPipeline(
      {
        runId: 'run-err',
        userId: 'user-1',
        costCapUsd: 5,
        retentionExpiry: Date.now() + 1000
      },
      deps
    );

    expect(fns.logError).toHaveBeenCalledWith('gmail_metadata_failed', expect.any(String), { gmailId: 'g1' });
    expect(fns.updateProgress).toHaveBeenCalled();
    expect(fns.completeRun).toHaveBeenCalledTimes(1);
    expect(result.newslettersClassified).toBe(0);
  });

  it('aborts on budget cap and marks failed', async () => {
    const { deps, fns } = baseDeps();
    deps.extractCompanies = vi.fn().mockResolvedValue({ created: 1, costUsd: 1.1 });

    const result = await runScanPipeline(
      {
        runId: 'run-budget',
        userId: 'user-1',
        costCapUsd: 0.5,
        retentionExpiry: Date.now() + 1000
      },
      deps
    );

    expect(fns.logError).toHaveBeenCalledWith(
      'cost_cap_exceeded',
      expect.stringContaining('Scan aborted'),
      expect.objectContaining({ capUsd: 0.5 })
    );
    expect(fns.markFailed).toHaveBeenCalledTimes(1);
    expect(fns.completeRun).not.toHaveBeenCalled();
    expect(result.abortedByBudget).toBe(true);
  });
});
