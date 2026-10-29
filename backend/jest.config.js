module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { diagnostics: false }] },
  // Stack tests bundle Lambda code with esbuild, which can take a few seconds.
  testTimeout: 60000,
};
