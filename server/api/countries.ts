import type { FastifyInstance } from 'fastify';
import type { CountryDossier, PolicyRecord } from '../../shared/contracts.ts';
import { NotFoundError } from '../errors.ts';
import { getCountryDossier, getPolicyRecord } from '../services/countries.ts';
import type { ApiDependencies } from './deps.ts';
import { parseDemoFlag, parseIso2Param, parseRouteCodeParam } from './query.ts';

/** GET /api/v1/countries/:iso2：国家签证档案（目录内无资料国家返回 200 + 空政策） */
export function registerCountryRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  app.get('/api/v1/countries/:iso2', async (request): Promise<{ data: CountryDossier }> => {
    const params = request.params as { iso2?: string };
    const iso2 = parseIso2Param(params.iso2);
    const includeDemo = parseDemoFlag((request.query as Record<string, unknown>).demo);
    const dossier = await getCountryDossier(deps.db, iso2, { includeDemo });
    if (dossier === null) {
      throw new NotFoundError(`未收录国家/地区代码：${iso2}`);
    }
    return { data: dossier };
  });

  app.get('/api/v1/route/:routeCode', async (request): Promise<{ data: PolicyRecord }> => {
    const params = request.params as { routeCode?: string };
    const routeCode = parseRouteCodeParam(params.routeCode);
    const policy = await getPolicyRecord(deps.db, routeCode);
    if (policy === null) {
      throw new NotFoundError(`未找到可公开的路线：${routeCode}`);
    }
    return { data: policy };
  });
}
