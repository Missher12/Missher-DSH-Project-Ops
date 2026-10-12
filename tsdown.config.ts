import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/cordis.ts', 'src/client/index.tsx'],
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
    fixedExtension: false, sourcemap: false, dts: true, clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//, /^react(?:\/|$)/] },
  },
  {
    // Host's public closure-factory protocol; React identity comes from its module table.
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib/browser', format: 'cjs', platform: 'browser', target: 'es2022',
    fixedExtension: false, sourcemap: false, dts: false, clean: false,
    deps: { neverBundle: [/^react(?:\/|$)/], alwaysBundle: [/^@deepseek-ai\/dsh-util-workspace-path/] },
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@missher/dsh-project-ops", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
