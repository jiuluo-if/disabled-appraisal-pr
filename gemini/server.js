import https from 'node:https';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { createApp } from './lib/app.js';

dotenv.config({ quiet: true });
const integer = (name, fallback, minimum, maximum) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
};

try {
  if (!process.env.KIMI_API_KEY) throw new Error('KIMI_API_KEY is required; configure gemini/.env');
  const config = {
    apiKey: process.env.KIMI_API_KEY,
    apiUrl: process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1/chat/completions',
    textModel: process.env.KIMI_TEXT_MODEL || 'kimi-k2.6',
    visionModel: process.env.KIMI_VISION_MODEL || 'kimi-k2.6',
    timeoutMs: integer('REQUEST_TIMEOUT_MS', 90000, 1000, 300000),
    maxTokens: integer('KIMI_MAX_TOKENS', 10000, 1024, 32768),
    thinking: process.env.KIMI_THINKING === 'enabled' ? 'enabled' : 'disabled',
    jsonMode: process.env.KIMI_JSON_MODE === 'object' ? 'object' : 'schema',
  };
  const options = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH || 'gemini.lintsing.net.key'),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH || 'gemini.lintsing.net.pem'),
  };
  const server = https.createServer(options, createApp(config));
  server.requestTimeout = config.timeoutMs + 15000;
  server.listen(integer('PORT', 3000, 1, 65535), process.env.HOST || '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'started', port: server.address().port, textModel: config.textModel, visionModel: config.visionModel }));
  });
  server.on('error', error => { console.error('HTTPS listener failed:', error.code); process.exitCode = 1; });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (error) {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
}
