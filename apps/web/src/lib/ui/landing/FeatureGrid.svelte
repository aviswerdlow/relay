<script lang="ts">
    import { Sparkles, FileSearch, ShieldCheck } from "lucide-svelte";
</script>

<section id="how-it-works" class="py-24 bg-slate-50 dark:bg-slate-900/50">
    <div class="container mx-auto px-4">
        <div class="grid gap-8 md:grid-cols-3">
            <!-- Feature 1 -->
            <div
                class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
                <div
                    class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                >
                    <Sparkles class="h-6 w-6" />
                </div>
                <h3
                    class="mb-2 text-xl font-semibold text-slate-900 dark:text-white"
                >
                    Automated Extraction
                </h3>
                <p class="text-slate-600 dark:text-slate-400">
                    We parse thousands of newsletters to find net-new consumer
                    apps, so you don't have to read every line.
                </p>
            </div>

            <!-- Feature 2 -->
            <div
                class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
                <div
                    class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                >
                    <FileSearch class="h-6 w-6" />
                </div>
                <h3
                    class="mb-2 text-xl font-semibold text-slate-900 dark:text-white"
                >
                    Evidence-Based
                </h3>
                <p class="text-slate-600 dark:text-slate-400">
                    Every lead comes with source snippets and direct links to
                    the original email. Zero hallucination.
                </p>
            </div>

            <!-- Feature 3 -->
            <div
                class="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
                <div
                    class="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                >
                    <ShieldCheck class="h-6 w-6" />
                </div>
                <h3
                    class="mb-2 text-xl font-semibold text-slate-900 dark:text-white"
                >
                    Private & Ephemeral
                </h3>
                <p class="text-slate-600 dark:text-slate-400">
                    Your data stays yours. We store snippets for 30 days and
                    never train on your emails.
                </p>
            </div>
        </div>
    </div>
</section>
