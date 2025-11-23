import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			fontFamily: {
				sans: ['Inter', 'sans-serif']
			},
			colors: {
				// Custom color palette extensions if needed, 
				// otherwise relying on standard Tailwind colors (slate, blue, emerald, rose)
			}
		}
	},
	plugins: []
} satisfies Config;
