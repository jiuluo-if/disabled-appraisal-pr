import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { assessmentTypeSchema, requestSchema } from './contracts.js';
import { catalogs } from './catalog.js';
import { createProvider, ServiceError } from './provider.js';
import { assess } from './assessment.js';
import { legacyResponse } from './results.js';

function legacyInput(body) {
  const parts = body?.contents?.[0]?.parts;
  if (!Array.isArray(parts) || !parts.length) return body;
  const description = parts.filter(part => typeof part?.text === 'string').map(part => part.text).join('\n');
  return { assessmentType: body.assessmentType || (description.includes('人体损伤致残程度分级') ? 'disability' : 'injury'),
    description, images: parts.filter(part => part?.inline_data).map(part => ({ mimeType: part.inline_data.mime_type || 'image/jpeg', data: part.inline_data.data, name: '' })) };
}

function validateImages(images) {
  for (const image of images) {
    const data = Buffer.from(image.data, 'base64');
    const valid = /^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
      && ((image.mimeType === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8)
      || (image.mimeType === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      || (image.mimeType === 'image/webp' && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'));
    if (!valid) throw new ServiceError(400, 'INVALID_IMAGE', '图片格式与内容不符，请重新上传JPEG、PNG或WebP图片。');
  }
}

export function createApp(config, options = {}) {
  const app = express();
  const provider = options.provider || createProvider(config, options.fetchImpl);
  app.disable('x-powered-by');
  app.use(cors());
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '50mb' }));
  app.get('/', (req, res) => res.send('Kimi HTTPS Proxy is Running!'));
  app.get('/api/health/live', (req, res) => res.json({ status: 'ok', version: 2 }));
  app.get('/api/health/ready', async (req, res) => {
    const health = await provider.readiness();
    res.status(health.status === 'ready' ? 200 : 503).json(health);
  });
  app.get('/api/standards/:type', (req, res) => {
    const kind = assessmentTypeSchema.safeParse(req.params.type);
    if (!kind.success) throw new ServiceError(404, 'STANDARD_NOT_FOUND', '未找到该评估类型的标准。');
    res.json(catalogs[kind.data]);
  });
  app.post('/api/analyze', async (req, res, next) => {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new ServiceError(504, 'ANALYSIS_TIMEOUT', '本次分析超时，未生成结论，请稍后重试或精简材料。')), config.timeoutMs);
    const disconnected = () => { if (!res.writableEnded) controller.abort(new ServiceError(499, 'CLIENT_CANCELLED', '本次分析已取消。')); };
    res.on('close', disconnected);
    try {
      const parsed = requestSchema.safeParse(legacyInput(req.body));
      if (!parsed.success) throw new ServiceError(400, 'INVALID_REQUEST', parsed.error.issues[0].message);
      validateImages(parsed.data.images);
      const result = await assess(parsed.data, { provider, config, signal: controller.signal, requestId: req.requestId });
      if (!res.destroyed) res.json({ result, candidates: [{ content: { parts: [{ text: JSON.stringify(legacyResponse(result)) }] } }] });
    } catch (error) {
      if (!res.destroyed) next(controller.signal.aborted ? controller.signal.reason : error);
    } finally {
      clearTimeout(timeout);
      res.off('close', disconnected);
      console.log(JSON.stringify({ event: 'analysis', requestId: req.requestId, durationMs: Date.now() - started,
        status: controller.signal.aborted && res.destroyed ? 499 : res.statusCode, cancelled: controller.signal.aborted }));
    }
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof ServiceError;
    const malformed = error.type === 'entity.parse.failed';
    const tooLarge = error.type === 'entity.too.large';
    const uploadAborted = error.type === 'request.aborted';
    const unsupported = ['encoding.unsupported', 'charset.unsupported'].includes(error.type);
    const status = known ? error.status : malformed || uploadAborted ? 400 : tooLarge ? 413 : unsupported ? 415 : 500;
    const code = known ? error.code : malformed ? 'INVALID_JSON' : tooLarge ? 'PAYLOAD_TOO_LARGE' : uploadAborted ? 'UPLOAD_INTERRUPTED' : unsupported ? 'UNSUPPORTED_ENCODING' : 'INTERNAL_ERROR';
    console.error(JSON.stringify({ event: 'error', requestId: req.requestId, code, status,
      method: req.method, route: req.route?.path || 'unmatched', errorType: error.type || error.name || 'Error' }));
    if (res.destroyed) return;
    res.status(status).json({ error: { code, message: known ? error.message : malformed ? '请求内容不是有效JSON。' : tooLarge ? '提交材料过大，请压缩图片或分批上传。' : uploadAborted ? '材料上传已中断，请检查网络后重新提交。' : unsupported ? '请求编码不受支持，请重新提交材料。' : '分析服务暂时异常，请稍后重试。', requestId: req.requestId } });
  });
  return app;
}
