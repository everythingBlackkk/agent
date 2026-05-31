import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli/index.ts',
    'browser-mcp': 'src/browser/mcpServer.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  shims: false,
  sourcemap: true,
  // Bundle our own code; leave Ink's optional devtools and other peer-
  // optional deps external so esbuild doesn't fail on unresolved
  // requires. The npm install pulls dependencies in via package.json.
  external: ['react-devtools-core', 'yoga-wasm-web', 'bufferutil', 'utf-8-validate'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
