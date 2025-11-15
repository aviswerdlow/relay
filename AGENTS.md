# Repository Guidelines

## Project Structure & Module Organization
- `docs/` holds the PRD and TDD—keep them in sync with every feature decision.
- Keep the SvelteKit client in `apps/web/src/` (routes under `routes/`, shared UI in `lib/ui/`) and Convex logic in `convex/` mirroring the modules named in `docs/TDD.md`.
- Store shared DTOs in `packages/types/` (or `convex/types.ts`) so both sides reuse identical contracts, and keep large fixtures or CSV exports under `tests/fixtures/`.

## Build, Test, and Development Commands
- `pnpm install` — install workspace dependencies after each fresh clone or branch switch.
- `pnpm dev` — run the SvelteKit dev server on `localhost:5173`; pair it with `pnpm dev:convex` for backend calls once Convex is configured.
- `pnpm test` — execute Vitest suites; keep them fast enough for pre-push checks.
- `pnpm lint` / `pnpm format` — apply ESLint and Prettier before opening a PR.

## Coding Style & Naming Conventions
- TypeScript-first, two-space indentation, trailing commas, and double quotes enforced by Prettier.
- Name SvelteKit routes with kebab-case folders (`scan-progress/+page.svelte`) and Convex actions in camelCase (`startScan`, `listCompanies`).
- Co-locate component styles in `.postcss` modules; reserve `apps/web/src/lib/styles/` for shared utilities only.

## Testing Guidelines
- Place unit tests next to source in `__tests__/` directories with the `.spec.ts` suffix.
- Exercise Convex actions through Vitest + Convex test utilities to validate success and failure paths.
- Maintain Playwright smoke tests under `apps/web/tests/` covering OAuth sign-in, scan execution, and CSV export; target ≥80% branch coverage on Convex code.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) and keep each commit focused on one concern.
- PRs must cite the related Linear/GitHub issue, include screenshots or terminal output for UX changes, and list verification steps taken.
- Require at least one reviewer; scrub OAuth and Convex secrets before requesting merge.

## Security & Configuration Tips
- Keep Gmail OAuth credentials, Convex deployment URLs, and OpenAI keys in `.env.local`, which stays untracked.
- Rotate Convex auth tokens and purge cached email bodies every 30 days, and limit testing to Google OAuth allowlisted accounts during the private alpha.
- Ensure `TOKEN_ENCRYPTION_SECRET` is ≥32 bytes (hex/base64/UTF-8). Set `PUBLIC_CONVEX_URL` to your Convex deployment and use `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5173/auth/google/callback` for local dev.
