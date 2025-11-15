# Relay Workspace

This repo hosts the Relay private-alpha stack described in `docs/PRD.md` and `docs/TDD.md`. The codebase uses a pnpm workspace to keep the SvelteKit web client, Convex backend, and shared TypeScript contracts aligned.

## Project layout

- `apps/web` – SvelteKit client (TypeScript, Vite). Routes, UI components, and stores live here.
- `convex` – Convex functions, schema, and utilities. Modules mirror the TDD decomposition (`auth`, `scan`, `gmail`, `companies`, `export`, `crons`, `util`).
- `packages/types` – Shared enums and DTOs used by both the frontend and backend.
- `docs` – Product and technical design references.

## Getting started

```bash
pnpm install
pnpm dev            # starts apps/web dev server
pnpm dev:convex     # runs Convex dev watcher (prompts for login/config)
```

Additional workspace scripts:

- `pnpm typecheck` – run type checking across packages (`apps/web`, `convex`, `packages/types`).
- `pnpm lint` – placeholder hook that calls package-level linters where present.
- `pnpm test` – runs package-level test suites when added.

### Environment setup

- Copy `.env.local.example` to `.env.local` and fill in Google OAuth credentials, Convex deployment URL, and the token encryption secret (32+ bytes).
- `PUBLIC_CONVEX_URL` should point to your Convex deployment (from the dashboard or `pnpm dev:convex` output).
- `convex.json` contains placeholder project metadata; run `pnpm dev:convex` to configure a dev deployment when ready.
- Restart dev servers after changing env vars so SvelteKit picks up the new values.

Refer to `AGENTS.md` for contributor guidelines and links to relevant docs.
