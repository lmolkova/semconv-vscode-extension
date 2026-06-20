import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the pure analysis-core unit tests. Integration tests under
    // test/integration import the `vscode` module and run via @vscode/test-electron.
    include: ['server/src/**/*.test.ts']
  }
});
