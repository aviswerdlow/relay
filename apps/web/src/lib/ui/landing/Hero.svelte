<script lang="ts">
    import { ArrowRight } from "lucide-svelte";
</script>

<section class="relative overflow-hidden pt-20 pb-28 md:pt-32 md:pb-40">
    <!-- Background decoration -->
    <div
        class="absolute top-0 left-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-[100px]"
    ></div>

    <div class="container mx-auto px-4 text-center">
        <div class="mx-auto max-w-4xl">
            <h1
                class="mb-6 text-5xl font-bold tracking-tight text-slate-900 dark:text-white md:text-7xl"
            >
                Turn Your Inbox into a <br />
                <span
                    class="bg-gradient-to-r from-blue-600 to-emerald-500 bg-clip-text text-transparent"
                    >Deal Flow Engine</span
                >
            </h1>

            <p
                class="mb-10 text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto"
            >
                Automatically scan Substack, Beehiiv, and Buttondown newsletters
                for new consumer startups. AI-extracted, scored, and deduped.
            </p>

            <div
                class="flex flex-col items-center justify-center gap-4 sm:flex-row"
            >
                <a
                    href="/auth/google"
                    class="group inline-flex items-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/25 active:scale-95"
                >
                    Connect Gmail & Scan
                    <ArrowRight
                        class="h-5 w-5 transition-transform group-hover:translate-x-1"
                    />
                </a>

                <a
                    href="#how-it-works"
                    class="inline-flex items-center gap-2 rounded-full px-8 py-4 text-lg font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                    How it Works
                </a>
            </div>
        </div>
    </div>
</section>
