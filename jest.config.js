module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['./__tests__/setup.js'],
  collectCoverageFrom: [
    'controllers/**/*.js',
    'services/**/*.js',
    '!services/cronService.js',
  ],
  coverageThreshold: {
    // Per-file guards for the controllers that have dedicated tests
    './controllers/walletController.js': { lines: 75, functions: 75 },
    './controllers/tripController.js':   { lines: 75, functions: 65 },
  },
  testTimeout: 15000,
  forceExit: true,
  verbose: true,
  clearMocks: true,
  resetMocks: false,
};
