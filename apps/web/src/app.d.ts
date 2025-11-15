// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			session: import('@relay/types').SessionSummary | null;
		}
		interface PageData {
			session: import('@relay/types').SessionSummary | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
