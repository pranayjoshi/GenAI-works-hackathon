export {};
// Starts the UI and API in sample mode on port 8788; works on any OS (no shell env syntax).
process.env.SAMPLE_MODE = 'true';
process.env.PORT ??= '8788';
await import('../src/api.js');
