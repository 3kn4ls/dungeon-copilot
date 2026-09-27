import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Los paquetes internos exportan TypeScript sin compilar: se empaquetan dentro del servidor.
  noExternal: [/^@dungeon-copilot\//],
});
