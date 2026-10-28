import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('development API proxy follows the backend HTTP port when no override is set', async () => {
  const envPath = path.join(projectRoot, 'gemini', '.env');
  const examplePath = path.join(projectRoot, 'gemini', '.env.example');
  const backendEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const backendExample = readFileSync(examplePath, 'utf8');
  const port = process.env.PORT || backendEnv.match(/^PORT=(\d+)$/m)?.[1]
    || backendExample.match(/^PORT=(\d+)$/m)?.[1]
    || '3000';
  const originalDevApiUrl = process.env.DEV_API_URL;
  delete process.env.DEV_API_URL;

  try {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.join(projectRoot, 'vite.config.js'),
      projectRoot,
    );

    assert.equal(loaded.config.server.proxy['/api'].target, `http://127.0.0.1:${port}`);
  } finally {
    if (originalDevApiUrl === undefined) delete process.env.DEV_API_URL;
    else process.env.DEV_API_URL = originalDevApiUrl;
  }
});
