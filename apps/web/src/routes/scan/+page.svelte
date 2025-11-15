<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	type Progress = {
		status: string;
		totalMessages: number;
		processedMessages: number;
		processedCompanies: number;
		newslettersClassified: number;
		lastUpdatedAt: number;
	};

	let runId: string | null = null;
	let progress: Progress | null = null;
	let error: string | null = null;
	let pollingHandle: ReturnType<typeof setTimeout> | null = null;
	let isLoading = false;

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
		{/if}
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	{#if progress}
		<section class="status">
			<h2>Status: <span class="status-badge {progress.status}">{progress.status}</span></h2>
			<ul>
				<li>Total messages examined: {progress.totalMessages}</li>
				<li>Messages processed: {progress.processedMessages}</li>
				<li>Newsletters captured: {progress.newslettersClassified}</li>
			</ul>
			<p class="updated">
				Last updated: {new Date(progress.lastUpdatedAt).toLocaleTimeString()}
			</p>
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
		margin: 0;
		padding-left: 1.2rem;
		line-height: 1.8;
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
</style>
