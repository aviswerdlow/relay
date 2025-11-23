<script lang="ts">
    import Sidebar from "$lib/ui/Sidebar.svelte";
</script>

<div class="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
    <Sidebar />
    <main class="flex-1 overflow-y-auto">
        <div class="container mx-auto px-6 py-8">
            <slot />
        </div>
    </main>
</div>
