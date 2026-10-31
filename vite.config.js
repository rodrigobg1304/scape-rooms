import { defineConfig } from 'vite';

// En GitHub Pages la web cuelga de /<repositorio>/. En local se sirve desde la raíz.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
});
