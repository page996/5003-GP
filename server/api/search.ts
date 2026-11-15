import type { FastifyInstance } from 'fastify';
import type { SearchResponse } from '../../shared/contracts.ts';
import { search } from '../services/search.ts';
import type { ApiDependencies } from './deps.ts';
import { parseSearchQuery } from './query.ts';

/** GET /api/v1/search：关键词 + 分面筛选 + 分页 */
export function registerSearchRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  app.get('/api/v1/search', async (request): Promise<{ data: SearchResponse }> => {
    const query = parseSearchQuery(request.query);
    return { data: await search(deps.db, query) };
  });
}
