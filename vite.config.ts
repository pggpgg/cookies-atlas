import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Relative base: the same build works on GitHub Pages (/cookies-atlas/), a fork, or any static host.
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
