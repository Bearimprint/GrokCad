import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { fsApiPlugin } from './vite-plugin-fs-api';
import { libraryApiPlugin } from './vite-plugin-library-api';
import { openHelpPlugin } from './vite-plugin-open-help';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    open: false,
  },
  plugins: [
    libraryApiPlugin(path.resolve(rootDir, 'library')),
    openHelpPlugin(path.resolve(rootDir, 'HELP.md')),
    fsApiPlugin(),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
