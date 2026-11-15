import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '../../shared/contracts.ts';
import { loadAppMeta } from '../db/repository.ts';
import type { ApiDependencies } from './deps.ts';

/** GET /api/health：存活、数据库模式、数据集版本、运行时长 */
export function registerHealthRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  app.get('/api/health', async (): Promise<{ data: HealthResponse }> => {
    const meta = await loadAppMeta(deps.db);
    return {
      data: {
        status: 'ok',
        mode: deps.db.mode,
        datasetVersion: meta.get('dataset_version') ?? 'unknown',
        uptimeSeconds: Math.round(process.uptime() * 10) / 10,
      },
    };
  });
}
