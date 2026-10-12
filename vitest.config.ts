import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const double = (name: string): string => fileURLToPath(new URL(`./tests/doubles/${name}`, import.meta.url))

export default defineConfig({
  // The Host serves `react-dom` and the UI primitives from its platform module
  // table; they are not npm dependencies of this package, so unit tests bind
  // them to the documented doubles under tests/doubles.
  resolve: {
    alias: {
      'react-dom': double('react-dom.ts'),
      '@deepseek-ai/dsh-client-ui-primitives': double('ui-primitives.tsx'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
