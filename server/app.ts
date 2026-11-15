/**
 * Fastify 应用装配。
 *
 * 与 main.ts 分离，便于测试用 app.inject() 直接打路由：
 * - 注册 @fastify/rate-limit（240 次/分钟）；
 * - API 响应统一 no-store + 安全头，错误统一 {error:{code,message,details?}}；
 * - dist 存在时托管 Vite 构建产物，非 /api 路由回退 index.html（SPA 深链）；
 * - 未知 /api 路由返回 JSON 404，未预期异常返回 500 且不泄露堆栈。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from 'fastify';
import type { ApiErrorBody } from '../shared/contracts.ts';
import type { AppConfig } from './config.ts';
import type { DatabaseDriver } from './db/driver.ts';
import { AppError } from './errors.ts';
import { DIST_DIR } from './paths.ts';
import { registerApiRoutes } from './api/index.ts';

export const RATE_LIMIT_MAX = 240;

export interface BuildAppOptions {
  db: DatabaseDriver;
  config: AppConfig;
  logger?: FastifyServerOptions['logger'];
  /** 是否托管 dist（默认 false；main.ts 在生产/构建后开启） */
  serveStatic?: boolean;
  rateLimitMax?: number;
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: ApiErrorBody['error']['details'],
): void {
  reply.status(statusCode).send({ error: { code, message, ...(details ? { details } : {}) } });
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  // 只读 API：全部禁用缓存，并加上基础安全头；静态资源不加 no-store
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Frame-Options', 'DENY');
    }
    return payload;
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: options.rateLimitMax ?? RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new AppError('RATE_LIMITED', 429, `请求过于频繁，请 ${Math.ceil(context.ttl / 1000)} 秒后再试`),
  });

  registerApiRoutes(app, { db: options.db });

  const spaEnabled = (options.serveStatic ?? false) && existsSync(path.join(DIST_DIR, 'index.html'));
  if (spaEnabled) {
    await app.register(fastifyStatic, {
      root: DIST_DIR,
      prefix: '/',
      // 只注册真实存在的文件路由；未知路径交给下面的 SPA 回退
      wildcard: false,
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api');
    // 只有“看起来像页面路由”的路径才回退 SPA；缺失的 /assets/* 或带扩展名的资源应返回 404，
    // 避免浏览器把 HTML 当 JS/CSS 解析（返回 200 的 index.html 会掩盖资源丢失）。
    const looksLikeAsset =
      /^\/(assets|geo)\//.test(request.url) || /\.[a-z0-9]{2,5}(?:\?|$)/i.test(request.url);
    if (!isApi && !looksLikeAsset && spaEnabled && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.type('text/html').sendFile('index.html');
    }
    sendError(reply, 404, 'NOT_FOUND', isApi ? '接口不存在' : '资源不存在');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      sendError(reply, error.httpStatus, error.code, error.message, error.details);
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 429) {
      sendError(reply, 429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
      return;
    }
    if (statusCode === 400) {
      sendError(reply, 400, 'VALIDATION_ERROR', '请求参数不合法');
      return;
    }
    // 内部异常只进日志，响应体不包含堆栈/实现细节
    request.log.error({ err: error }, '未处理的服务端异常');
    sendError(reply, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后再试');
  });

  return app;
}
