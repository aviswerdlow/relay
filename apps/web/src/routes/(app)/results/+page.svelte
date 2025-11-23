<script lang="ts">
	import type { PageData } from './$types';
	import { onDestroy, onMount } from 'svelte';

	export let data: PageData;

	type Company = PageData['companies'][number];

	let companies: Company[] = data.companies ?? [];
	let filterDecision: 'all' | 'saved' | 'ignored' | 'unreviewed' = 'all';
	let selectedCategory = 'all';
	let selectedStage = 'all';
	let selectedPlatform = 'all';
	let exporting = false;
	let exportError: string | null = null;
	let downloadUrl: string | null = null;
	let loading = false;
	let loadError: string | null = null;
	let expandedCompanyId: string | null = null;
	let selectedIndex = 0;

	onMount(() => {
		companies = data.companies ?? [];
		window.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		window.removeEventListener('keydown', handleKeydown);
	});

	$: filtered = companies.filter((company) => {
		if (filterDecision !== 'all' && company.decision !== filterDecision) return false;
		if (selectedCategory !== 'all' && company.category !== selectedCategory) return false;
		if (selectedStage !== 'all' && company.stage !== selectedStage) return false;
		if (selectedPlatform !== 'all' && company.newsletterPlatform !== selectedPlatform) return false;
		return true;
	});

	$: categoryOptions = Array.from(new Set(companies.map((c) => c.category))).sort();
	$: stageOptions = Array.from(new Set(companies.map((c) => c.stage))).sort();
	$: platformOptions = Array.from(
		new Set(companies.map((c) => c.newsletterPlatform).filter(Boolean) as string[])
	).sort();

	async function loadCompanies() {
		loading = true;
		loadError = null;
		try {
			const params = new URLSearchParams();
			if (filterDecision !== 'all') params.set('decision', filterDecision);
			if (selectedCategory !== 'all') params.set('categories', selectedCategory);
			if (selectedStage !== 'all') params.set('stages', selectedStage);
			if (selectedPlatform !== 'all') params.set('platforms', selectedPlatform);

			const res = await fetch(`/api/companies?${params.toString()}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? 'Failed to load companies');
			}
			const body = await res.json();
			companies = body.companies ?? [];
			selectedIndex = 0;
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Unable to load companies';
		} finally {
			loading = false;
		}
	}

	function handleFilterChange() {
		loadCompanies();
	}

	async function updateDecision(company: Company, decision: 'saved' | 'ignored' | 'unreviewed') {
		try {
			await fetch('/api/companies', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ companyId: company.id, decision })
			});
			company.decision = decision;
		} catch (err) {
			exportError =
				err instanceof Error ? err.message : `Unable to update ${company.name}. Try again later.`;
		}
	}

	function toggleEvidence(companyId: string) {
		expandedCompanyId = expandedCompanyId === companyId ? null : companyId;
	}

	function gmailLink(company: Company) {
		const id = company.sourceEmailIds?.[0];
		return id ? `https://mail.google.com/mail/u/0/#all/${id}` : '#';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!filtered.length) return;
		if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName ?? '')) return;
		if (event.key === 'j') {
			selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
			event.preventDefault();
		} else if (event.key === 'k') {
			selectedIndex = Math.max(selectedIndex - 1, 0);
			event.preventDefault();
		} else if (event.key === 's') {
			updateDecision(filtered[selectedIndex], 'saved');
			event.preventDefault();
		} else if (event.key === 'x') {
			updateDecision(filtered[selectedIndex], 'ignored');
			event.preventDefault();
		} else if (event.key === 'Enter') {
			const company = filtered[selectedIndex];
			toggleEvidence(company.id);
			event.preventDefault();
		}
	}

	async function exportCsv() {
		exporting = true;
		exportError = null;
		downloadUrl = null;

		try {
			const res = await fetch('/api/export', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ decision: filterDecision === 'all' ? undefined : filterDecision })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.error ?? 'Export failed');
			}

			const body = await res.json();
			downloadUrl = body.export?.url ?? null;
			if (downloadUrl) {
				window.open(downloadUrl, '_blank');
			}
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Failed to export CSV';
		} finally {
			exporting = false;
		}
	}
</script>

<section class="results">
	<header>
		<h1>Review Companies</h1>
		<p>Inspect extracted startups, verify evidence, and mark them saved or ignored.</p>
	</header>

	<div class="filters">
		<label>
			Decision:
			<select bind:value={filterDecision} on:change={handleFilterChange}>
				<option value="all">All</option>
				<option value="unreviewed">Unreviewed</option>
				<option value="saved">Saved</option>
				<option value="ignored">Ignored</option>
			</select>
		</label>
		<label>
			Category:
			<select bind:value={selectedCategory} on:change={handleFilterChange}>
				<option value="all">All</option>
				{#each categoryOptions as option}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		<label>
			Stage:
			<select bind:value={selectedStage} on:change={handleFilterChange}>
				<option value="all">All</option>
				{#each stageOptions as option}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		<label>
			Source:
			<select bind:value={selectedPlatform} on:change={handleFilterChange}>
				<option value="all">All</option>
				{#each platformOptions as option}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		<button class="export" on:click={exportCsv} disabled={exporting}>
			{exporting ? 'Generating…' : 'Export CSV'}
		</button>
	</div>

	{#if exportError}
		<p class="error">{exportError}</p>
	{/if}
	{#if loadError}
		<p class="error">{loadError}</p>
	{/if}
	{#if downloadUrl}
		<p class="note">
			<a href={downloadUrl} target="_blank" rel="noreferrer">Download ready</a>
		</p>
	{/if}

	{#if loading}
		<p class="empty">Loading companies…</p>
	{:else if filtered.length === 0}
		<p class="empty">No companies match the selected filters.</p>
	{:else}
		<div class="list">
			{#each filtered as company, index}
				<article class="company" class:selected={index === selectedIndex}>
					<div class="main">
						<div class="title-row">
							<a href={company.homepageUrl ?? '#'} target="_blank" rel="noreferrer">{company.name}</a>
							<span class="score">{Math.round(company.score * 100)}</span>
						</div>
						<p class="summary">{company.oneLineSummary}</p>
						<div class="chips">
							<span>{company.category}</span>
							<span>{company.stage}</span>
							{#if company.newsletterPlatform}<span>{company.newsletterPlatform}</span>{/if}
							{#each company.keySignals as signal}
								<span>{signal}</span>
							{/each}
						</div>
						<div class="evidence">
							<button type="button" class="evidence-toggle" on:click={() => toggleEvidence(company.id)}>
								{expandedCompanyId === company.id ? 'Hide evidence' : 'Show evidence'}
							</button>
							{#if expandedCompanyId === company.id}
								<div class="evidence-panel">
									{#each company.sourceSnippets ?? [] as snippet}
										<blockquote>{snippet.quote}</blockquote>
									{/each}
									{#if company.sourceEmailIds?.length}
										<a class="gmail-link" href={gmailLink(company)} target="_blank" rel="noreferrer">
											View in Gmail
										</a>
									{/if}
								</div>
							{/if}
						</div>
					</div>
					<div class="actions">
						<button class:selected={company.decision === 'saved'} on:click={() => updateDecision(company, 'saved')}>Save</button>
						<button class:selected={company.decision === 'ignored'} on:click={() => updateDecision(company, 'ignored')}>Ignore</button>
						<button class:selected={company.decision === 'unreviewed'} on:click={() => updateDecision(company, 'unreviewed')}>Reset</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</section>

<style>
	.results {
		padding: 3rem 1.5rem;
		max-width: 960px;
		margin: 0 auto;
		color: #f8fafc;
	}

	header h1 {
		font-size: 2.5rem;
		margin-bottom: 0.5rem;
	}

	header p {
		margin: 0 0 1.5rem;
		color: rgba(248, 250, 252, 0.75);
	}

.filters {
	margin-bottom: 1.5rem;
	display: flex;
	align-items: center;
	gap: 1rem;
}

select {
		margin-left: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.4);
		background: rgba(15, 23, 42, 0.6);
		color: #f8fafc;
	}

.empty {
	color: rgba(248, 250, 252, 0.75);
}

.export {
	background: rgba(59, 130, 246, 0.2);
	color: #bfdbfe;
	border: 1px solid rgba(59, 130, 246, 0.4);
	padding: 0.45rem 1rem;
	border-radius: 999px;
	cursor: pointer;
}

.export:disabled {
	opacity: 0.6;
	cursor: progress;
}

.error {
	color: #f87171;
	margin-bottom: 0.75rem;
}

.note {
	margin-top: 0.5rem;
	color: rgba(248, 250, 252, 0.65);
}

	.list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.company {
		display: flex;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 1.25rem;
		border-radius: 1rem;
		background: rgba(15, 23, 42, 0.7);
		border: 1px solid rgba(148, 163, 184, 0.2);
	}

	.company a {
		color: #93c5fd;
		text-decoration: none;
		font-size: 1.3rem;
		font-weight: 600;
	}

	.company .summary {
		margin: 0.5rem 0 0;
		color: rgba(248, 250, 252, 0.85);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.score {
		font-size: 0.9rem;
		padding: 0.15rem 0.75rem;
		border-radius: 999px;
		background: rgba(59, 130, 246, 0.2);
		color: #bfdbfe;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.75rem;
	}

	.chips span {
		font-size: 0.8rem;
		padding: 0.2rem 0.75rem;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.2);
		color: rgba(248, 250, 252, 0.8);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.actions button {
		padding: 0.4rem 1rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.5);
		background: transparent;
		color: #f8fafc;
		cursor: pointer;
	}

	.actions button.selected {
		background: rgba(59, 130, 246, 0.3);
		border-color: rgba(59, 130, 246, 0.7);
	}

	.company.selected {
		border-color: rgba(59, 130, 246, 0.5);
		box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.5);
	}

	.evidence {
		margin-top: 0.75rem;
	}

	.evidence-toggle {
		padding: 0.35rem 0.75rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.4);
		background: transparent;
		color: #f8fafc;
		cursor: pointer;
	}

	.evidence-panel {
		margin-top: 0.5rem;
		padding: 0.75rem;
		border-radius: 0.75rem;
		background: rgba(15, 23, 42, 0.5);
		border: 1px solid rgba(148, 163, 184, 0.2);
	}

	blockquote {
		margin: 0 0 0.5rem;
		font-style: italic;
		color: rgba(248, 250, 252, 0.85);
	}

	.gmail-link {
		color: #93c5fd;
		font-size: 0.85rem;
	}
</style>
