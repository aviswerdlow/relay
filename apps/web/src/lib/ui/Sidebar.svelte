<script lang="ts">
    import { page } from "$app/stores";
    import {
        LayoutDashboard,
        Scan,
        FileText,
        Settings,
        LogOut,
        User,
    } from "lucide-svelte";

    const navigation = [
        { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { name: "Scan", href: "/scan", icon: Scan },
        { name: "Results", href: "/results", icon: FileText },
        { name: "Settings", href: "/settings", icon: Settings },
    ];

    // Mock user for now - will be replaced with real auth data later
    const user = {
        name: "Demo User",
        email: "demo@example.com",
        avatar: null,
    };
</script>

<div
    class="flex h-screen w-64 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
>
    <!-- Logo Area -->
    <div
        class="flex h-16 items-center px-6 border-b border-slate-100 dark:border-slate-800"
    >
        <a
            href="/dashboard"
            class="flex items-center gap-2 font-bold text-xl text-slate-900 dark:text-white"
        >
            <div
                class="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white"
            >
                R
            </div>
            <span>Relay</span>
        </a>
    </div>

    <!-- Navigation -->
    <nav class="flex-1 space-y-1 px-3 py-4">
        {#each navigation as item}
            {@const isActive = $page.url.pathname.startsWith(item.href)}
            <a
                href={item.href}
                class="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors {isActive
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'}"
            >
                <svelte:component
                    this={item.icon}
                    class="h-5 w-5 {isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-400 group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-300'}"
                />
                {item.name}
            </a>
        {/each}
    </nav>

    <!-- User Profile -->
    <div class="border-t border-slate-200 p-4 dark:border-slate-800">
        <div class="flex items-center gap-3">
            <div
                class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"
            >
                {#if user.avatar}
                    <img
                        src={user.avatar}
                        alt={user.name}
                        class="h-10 w-10 rounded-full"
                    />
                {:else}
                    <User class="h-5 w-5 text-slate-500 dark:text-slate-400" />
                {/if}
            </div>
            <div class="flex-1 overflow-hidden">
                <p
                    class="truncate text-sm font-medium text-slate-900 dark:text-white"
                >
                    {user.name}
                </p>
                <p class="truncate text-xs text-slate-500 dark:text-slate-400">
                    {user.email}
                </p>
            </div>
            <button
                class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                title="Sign out"
            >
                <LogOut class="h-4 w-4" />
            </button>
        </div>
    </div>
</div>
