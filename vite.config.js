import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  base: '/vantage-scene-setup',  // Ensure this is correct
  plugins: [svelte()],
})

