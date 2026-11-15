import type { FastifyInstance } from 'fastify';
import { registerCountryRoutes } from './countries.ts';
import type { ApiDependencies } from './deps.ts';
import { registerHealthRoutes } from './health.ts';
import { registerOverviewRoutes } from './overview.ts';
import { registerSearchRoutes } from './search.ts';
import { registerSuggestRoutes } from './suggest.ts';

/** 注册全部只读 API 路由 */
export function registerApiRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  registerHealthRoutes(app, deps);
  registerOverviewRoutes(app, deps);
  registerSearchRoutes(app, deps);
  registerSuggestRoutes(app, deps);
  registerCountryRoutes(app, deps);
}
