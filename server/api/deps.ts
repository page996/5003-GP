import type { DatabaseDriver } from '../db/driver.ts';

/** API 路由依赖；测试可直接注入临时数据库驱动 */
export interface ApiDependencies {
  db: DatabaseDriver;
}
