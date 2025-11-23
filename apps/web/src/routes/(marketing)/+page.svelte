<script lang="ts">
	import Hero from "$lib/ui/landing/Hero.svelte";
	import FeatureGrid from "$lib/ui/landing/FeatureGrid.svelte";
</script>

<svelte:head>
	<title>Relay - Turn Your Inbox into a Deal Flow Engine</title>
	<meta
		name="description"
		content="Automatically scan Substack, Beehiiv, and Buttondown newsletters for new consumer startups. AI-extracted, scored, and deduped."
	/>
</svelte:head>

<div class="flex min-h-screen flex-col">
	<main class="flex-1">
		<Hero />
		<FeatureGrid />
	</main>

	<footer
		class="border-t border-slate-200 bg-white py-12 dark:border-slate-800 dark:bg-slate-900"
	>
		<div
			class="container mx-auto px-4 text-center text-slate-500 dark:text-slate-400"
		>
			<p>&copy; {new Date().getFullYear()} Relay. All rights reserved.</p>
			<div class="mt-4 flex justify-center gap-6">
				<a
					href="https://github.com/aviswerdlow/relay"
					class="hover:text-slate-900 dark:hover:text-white">GitHub</a
				>
				<a href="#" class="hover:text-slate-900 dark:hover:text-white"
					>Privacy</a
				>
				<a href="#" class="hover:text-slate-900 dark:hover:text-white"
					>Terms</a
				>
			</div>
		</div>
	</footer>
</div>
