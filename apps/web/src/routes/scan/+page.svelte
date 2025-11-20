<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	type RunError = {
		at: number;
		code: string;
		message?: string;
		context?: string;
	};

	type Progress = {
		status: string;
		totalMessages: number;
		processedMessages: number;
		processedCompanies: number;
		newslettersClassified: number;
		costUsd: number;
		errorCount: number;
		recentErrors: RunError[];
		failureReason?: string;
		lastUpdatedAt: number;
	};

	let runId: string | null = null;
	let workflowId: string | null = null;
	let progress: Progress | null = null;
	let error: string | null = null;
	let pollingHandle: ReturnType<typeof setTimeout> | null = null;
	let isLoading = false;
	const costFormatter = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 4
	});

	async function startScan() {
		error = null;
		isLoading = true;
		progress = null;
		runId = null;

		try {
			const res = await fetch('/api/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? 'Failed to start scan');
			}

			const body = await res.json();
			runId = body.runId;
			workflowId = body.workflowId ?? null;
			schedulePoll();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Unknown error';
		} finally {
			isLoading = false;
		}
	}

	function schedulePoll(delay = 2500) {
		if (pollingHandle) {
			clearTimeout(pollingHandle);
		}
		pollingHandle = setTimeout(poll, delay);
	}

	async function poll() {
		if (!runId) return;
		try {
			const res = await fetch(`/api/scan?runId=${encodeURIComponent(runId)}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? 'Failed to fetch progress');
			}

			const body = await res.json();
			progress = body.progress as Progress;

			if (progress.status === 'running') {
				schedulePoll();
			} else {
				pollingHandle = null;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Progress polling failed';
			pollingHandle = null;
		}
	}

	onDestroy(() => {
		if (pollingHandle) {
			clearTimeout(pollingHandle);
		}
	});

	function formatCost(amount: number) {
		return costFormatter.format(amount ?? 0);
	}

	function formatTime(timestamp: number) {
		return new Date(timestamp).toLocaleTimeString();
	}
</script>

<section class="scan">
	<header>
		<h1>Newsletter Scan</h1>
		<p>
			Scan the last {data.session?.settings.timeWindowDays ?? 90} days of Gmail newsletters for
			Substack, Beehiiv, or Buttondown mentions.
		</p>
	</header>

	<div class="actions">
		<button class="primary" on:click={startScan} disabled={isLoading}>
			{isLoading ? 'Starting…' : 'Scan Now'}
		</button>
		{#if runId}
			<p class="run-id">Run ID: {runId}</p>
			{#if workflowId}
				<p class="run-id">Workflow ID: {workflowId}</p>
			{/if}
		{/if}
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if progress}
		<section class="status">
			<h2>Status: <span class="status-badge {progress.status}">{progress.status}</span></h2>
			{#if progress.status === 'failed' && progress.failureReason}
				<p class="failure-reason">Failure reason: {progress.failureReason}</p>
			{/if}
			<ul class="metrics">
				<li>
					<span class="label">Queued newsletters</span>
					<span class="value">{progress.totalMessages}</span>
				</li>
				<li>
					<span class="label">Emails processed</span>
					<span class="value">{progress.processedMessages}</span>
				</li>
				<li>
					<span class="label">Newsletters classified</span>
					<span class="value">{progress.newslettersClassified}</span>
				</li>
				<li>
					<span class="label">Companies surfaced</span>
					<span class="value">{progress.processedCompanies}</span>
				</li>
				<li>
					<span class="label">OpenAI cost</span>
					<span class="value">{formatCost(progress.costUsd)}</span>
				</li>
				<li>
					<span class="label">Errors captured</span>
					<span class="value">{progress.errorCount}</span>
				</li>
			</ul>
			<p class="updated">
				Last updated: {formatTime(progress.lastUpdatedAt)}
			</p>
			{#if progress.recentErrors?.length}
				<section class="logs">
					<div class="logs-header">
						<h3>Recent errors</h3>
						<span class="error-count">{progress.errorCount} total</span>
					</div>
					<ul>
						{#each progress.recentErrors as entry}
							<li>
								<div class="log-row">
									<strong>{entry.code}</strong>
									<small>{formatTime(entry.at)}</small>
								</div>
								<p>{entry.message ?? 'No additional details provided.'}</p>
								{#if entry.context}
									<pre>{entry.context}</pre>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</section>
	{:else if runId}
		<p class="status-text">Fetching progress…</p>
	{/if}
</section>

<style>
	.scan {
		padding: 3rem 1.5rem;
		max-width: 720px;
		margin: 0 auto;
		color: #f8fafc;
	}

	header h1 {
		font-size: 2.25rem;
		margin-bottom: 0.5rem;
	}

	header p {
		margin: 0 0 1.5rem;
		color: rgba(248, 250, 252, 0.75);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.primary {
		background: #2563eb;
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 999px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}

	.primary:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.run-id {
		font-size: 0.85rem;
		color: rgba(248, 250, 252, 0.6);
	}

	.error {
		color: #f87171;
	}

	.status {
		background: rgba(30, 41, 59, 0.6);
		border-radius: 1rem;
		padding: 1.5rem;
	}

	.status h2 {
		margin-top: 0;
		margin-bottom: 1rem;
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.status ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.metrics {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 0.75rem;
		margin-top: 1rem;
	}

	.metrics li {
		background: rgba(15, 23, 42, 0.6);
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.metrics .label {
		text-transform: uppercase;
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		color: rgba(248, 250, 252, 0.6);
	}

	.metrics .value {
		font-size: 1.1rem;
		font-weight: 600;
	}

	.status-text {
		color: rgba(248, 250, 252, 0.75);
	}

	.status-badge {
		font-size: 0.85rem;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.status-badge.running {
		background: rgba(37, 99, 235, 0.2);
		color: #93c5fd;
	}

	.status-badge.complete {
		background: rgba(34, 197, 94, 0.2);
		color: #86efac;
	}

	.status-badge.failed {
		background: rgba(248, 113, 113, 0.2);
		color: #fca5a5;
	}

	.updated {
		font-size: 0.85rem;
		color: rgba(248, 250, 252, 0.6);
		margin-top: 1rem;
	}

	.failure-reason {
		color: #fca5a5;
		background: rgba(248, 113, 113, 0.12);
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
	}

	.logs {
		margin-top: 1.5rem;
		background: rgba(15, 23, 42, 0.6);
		border-radius: 0.75rem;
		padding: 1rem;
	}

	.logs-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.error-count {
		font-size: 0.85rem;
		color: rgba(248, 250, 252, 0.7);
	}

	.logs ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.logs li {
		padding: 0.5rem 0;
		border-top: 1px solid rgba(248, 250, 252, 0.08);
	}

	.logs li:first-child {
		border-top: none;
		padding-top: 0;
	}

	.log-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.9rem;
	}

	.log-row strong {
		color: #fbbf24;
	}

	.log-row small {
		color: rgba(248, 250, 252, 0.6);
	}

	.logs p {
		margin: 0.25rem 0 0;
		color: rgba(248, 250, 252, 0.85);
		font-size: 0.9rem;
	}

	.logs pre {
		margin: 0.25rem 0 0;
		padding: 0.4rem 0.5rem;
		background: rgba(15, 23, 42, 0.9);
		border-radius: 0.5rem;
		font-size: 0.8rem;
		overflow-x: auto;
	}
</style>
