/**
 * Standalone script to start the model proxy for E2E testing with Gemini CLI.
 * Usage: bun src/features/model-proxy/__tests__/run-proxy.ts
 * Outputs the proxy port on stdout, keeps running until killed.
 */
import {startModelProxy} from '../index';

const proxy = startModelProxy({gcpLocation: 'us-east5'});
if (!proxy) {
  console.error('Failed to start model proxy');
  process.exit(1);
}

// Print port for parent process to capture
console.log(`PROXY_PORT=${proxy.port}`);

// Keep alive until killed
process.on('SIGTERM', () => {
  proxy.stop();
  process.exit(0);
});
process.on('SIGINT', () => {
  proxy.stop();
  process.exit(0);
});

await new Promise(() => {});
