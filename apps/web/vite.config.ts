import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			'@relay/types': fileURLToPath(new URL('../../packages/types/src', import.meta.url))
		}
	}
});
