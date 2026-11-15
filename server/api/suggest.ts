import type { FastifyInstance } from 'fastify';
import type { Suggestion } from '../../shared/contracts.ts';
import { suggest } from '../services/suggest.ts';
import type { ApiDependencies } from './deps.ts';
import { parseSuggestQuery } from './query.ts';

/** GET /api/v1/suggest?q=：搜索框联想，最多 8 条 */
export function registerSuggestRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  app.get('/api/v1/suggest', async (request): Promise<{ data: Suggestion[] }> => {
    const query = parseSuggestQuery(request.query);
    return { data: await suggest(deps.db, query) };
  });
}
