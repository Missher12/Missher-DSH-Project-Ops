import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { defineConfig, type TsdownPlugin } from 'tsdown'

/**
 * Specifiers the Host web shell's platform module table answers for every
 * dynamic client bundle (shell 0.2.1-alpha.2 platform rows). They must stay
 * `require` calls in the CJS factory: inlining any of them would ship a second
 * React (or a second primitives) instance next to the one the shell already
 * handed to this bundle. `@deepseek-ai/dsh-util-workspace-path` is deliberately
 * absent — it is an inline-safe pure-values package with no shared runtime
 * identity.
 */
const PLATFORM_EXTERNAL = /^(?:react(?:\/|$)|react-dom(?:\/|$)|@deepseek-ai\/(?:cordis|dsh-client-(?:store|ui-slots|ui-primitives|ui-dockkit))(?:\/|$))/

/** The same contract as data, for the build-time gate's diagnostics. */
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * Inline `*.css?inline` imports as text.
 *
 * A client bundle is fetched outside Vite's module graph, so it cannot rely on
 * a stylesheet side channel: the sheet travels inside the factory instead. The
 * virtual id must not end in `.css`, because tsdown's own stylesheet handling
 * claims ids ending there.
 * @returns the resolve/load plugin pair.
 */
function cssTextPlugin(): TsdownPlugin {
  const prefix = '\0project-ops-css:'
  const suffix = '.mjs'
  // The virtual id is what bundler diagnostics and region markers print, so it
  // stays a bare name: an absolute id would leak a build-machine path into the
  // published artifact.
  const sheets = new Map<string, string>()
  let serial = 0
  return {
    name: 'project-ops-css-text-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css?inline')) return null
      const stylesheet = source.slice(0, -'?inline'.length)
      const file = importer === undefined || isAbsolute(stylesheet)
        ? stylesheet
        : resolvePath(dirname(importer), stylesheet)
      const virtualId = `${prefix}${basename(file)}.${serial++}${suffix}`
      sheets.set(virtualId, file)
      return virtualId
    },
    async load(virtualId: string) {
      const file = sheets.get(virtualId)
      if (file === undefined) return null
      // The virtual id hides the physical sheet from the watch graph.
      this.addWatchFile(file)
      const text = await readFile(file, 'utf8')
      return `export default ${JSON.stringify(text)};`
    },
  }
}

/**
 * Fail the build when the bundle would require a specifier the Host's module
 * table cannot answer: that is a guaranteed runtime throw, and a source-level
 * type import would not catch it.
 * @returns the bundle gate.
 */
function platformExternalPlugin(): TsdownPlugin {
  return {
    name: 'project-ops-platform-externals',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const specifier of output.imports) {
          if (!PLATFORM_EXTERNALS.includes(specifier)) {
            throw new Error(
              `client bundle: ${JSON.stringify(specifier)} is not a platform module-table row; `
              + `declare it in dsh.client.inject or inline it. Known rows: ${PLATFORM_EXTERNALS.join(', ')}`,
            )
          }
        }
      }
    },
  }
}

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/cordis.ts', 'src/client/index.tsx'],
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
    fixedExtension: false, sourcemap: false, dts: true, clean: false,
    deps: { neverBundle: [/^@deepseek-ai\//, /^react(?:\/|$)/, /^react-dom(?:\/|$)/] },
    plugins: [cssTextPlugin()],
  },
  {
    // Host's public closure-factory protocol; React identity comes from its module table.
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib/browser', format: 'cjs', platform: 'browser', target: 'es2022',
    fixedExtension: false, sourcemap: false, dts: false, clean: false,
    deps: {
      neverBundle: PLATFORM_EXTERNAL,
      alwaysBundle: [/^@deepseek-ai\/dsh-util-workspace-path/],
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [cssTextPlugin(), platformExternalPlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@missher/dsh-project-ops", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
