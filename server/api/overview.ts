import type { FastifyInstance } from 'fastify';
import type { OverviewResponse } from '../../shared/contracts.ts';
import { getOverview } from '../services/overview.ts';
import type { ApiDependencies } from './deps.ts';

/** GET /api/v1/overview：首屏一次拉取元信息/统计/地图/字典 */
export function registerOverviewRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  app.get('/api/v1/overview', async (): Promise<{ data: OverviewResponse }> => ({
    data: await getOverview(deps.db),
  }));
}
