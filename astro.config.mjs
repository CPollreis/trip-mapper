// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves a project site under /<repo>, so `base` has to match or
// every asset 404s. Local dev honours it too, hence the leading path in the
// dev URL.
export default defineConfig({
  site: 'https://cpollreis.github.io',
  base: '/trip-mapper',
  trailingSlash: 'ignore',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
