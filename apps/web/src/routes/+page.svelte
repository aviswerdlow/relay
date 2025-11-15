<script lang="ts">
	import type { PageData } from './$types';

	export let data: PageData;
</script>

{#if data.session}
	<section class="card">
		<h1>Welcome back!</h1>
		<p>
			Signed in as <strong>{data.session.email}</strong>.
		</p>
		<p>Next up: hook Gmail scanning and the reviewer UI.</p>
		<div class="links">
			<a class="cta secondary" href="/scan">Go to Scan Dashboard</a>
			<a class="cta secondary" href="/results">Review Results</a>
		</div>
	</section>
{:else}
	<section class="card">
		<h1>Relay private alpha</h1>
		<p>Connect your Google account to start ingesting newsletters.</p>
		<a class="cta" href="/auth/google">Connect Google</a>
		<p class="note">
			Scopes requested: Gmail read-only, profile, email (per PRD FR-1). Only test accounts should be used in
			private alpha.
		</p>
	</section>
{/if}

<style>
	.card {
		margin: 4rem auto;
		max-width: 480px;
		padding: 2rem;
		border-radius: 1rem;
		background: var(--surface-1, #111827);
		color: white;
		box-shadow:
			0 10px 25px rgba(0, 0, 0, 0.25),
			0 2px 8px rgba(0, 0, 0, 0.1);
		text-align: center;
	}

	h1 {
		font-size: 2rem;
		margin-bottom: 1rem;
	}

	.cta {
		display: inline-block;
		margin-top: 1.5rem;
		padding: 0.75rem 1.5rem;
		border-radius: 999px;
		background: #2563eb;
		color: white;
		text-decoration: none;
		font-weight: 600;
	}

	.cta:hover {
		background: #1d4ed8;
	}

	.cta.secondary {
		background: rgba(59, 130, 246, 0.15);
		border: 1px solid rgba(59, 130, 246, 0.4);
	}

	.cta.secondary:hover {
		background: rgba(59, 130, 246, 0.25);
	}

.note {
	margin-top: 1.5rem;
	font-size: 0.85rem;
	color: rgba(255, 255, 255, 0.8);
}

.links {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	margin-top: 1rem;
}
</style>
