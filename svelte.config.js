import { defineConfig } from 'vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { svelte } from '@sveltejs/vite-plugin-svelte';
const dev = process.argv.includes('dev');

export default defineConfig({
  base: dev ? '' : process.env.BASE_PATH,
  plugins: [svelte()],
  preprocess: vitePreprocess(),
});
