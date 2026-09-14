import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { DEFAULTS, type AppConfig } from '../src/config.js';
import { openDatabase, type Database } from '../src/db/connection.js';
import { SqliteHistoryStore } from '../src/db/historyStore.js';
import { migrate } from '../src/db/migrate.js';
import { buildServer } from '../src/server.js';

export const WORKED_EXAMPLE =
  'https://848.sharepoint.com/sites/848Technical/Projects/Forms/AllItems.aspx?id=%2Fsites%2F848Technical%2FProjects%2FProjects%20WIP%2FDeloitte%2FDeloitte%20%2D%20Digital%20Development%20Environment%2FSMR%20SIID%20029%20%2D%20Development%20Environment%20for%20Digital%20team%2Epdf&parent=%2Fsites%2F848Technical%2FProjects%2FProjects%20WIP%2FDeloitte%2FDeloitte%20%2D%20Digital%20Development%20Environment';

export const WORKED_EXAMPLE_PATH =
  '/sites/848Technical/Projects/Projects WIP/Deloitte/Deloitte - Digital Development Environment/SMR SIID 029 - Development Environment for Digital team.pdf';

export const FOLDER_LINK =
  'https://contoso.sharepoint.com/teams/SiteB/Lib/Forms/AllItems.aspx?id=%2Fteams%2FSiteB%2FLib%2FProjects%2FAlpha&parent=%2Fteams%2FSiteB%2FLib%2FProjects%2FAlpha';

export const TOKEN_LINK = 'https://contoso.sharepoint.com/:b:/s/SiteA/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abc?e=Ab12Cd';

export const SAFELINKS_LINK =
  'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fcontoso.sharepoint.com%2Fsites%2FSiteA%2FLib%2FFolder%2FPlan.docx&data=PLACEHOLDER&sdata=PLACEHOLDER&reserved=0';

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  store: SqliteHistoryStore;
  config: AppConfig;
}

export interface TestServerOptions {
  config?: Partial<AppConfig>;
}

/** An in-memory database, migrated, behind a server with logging silenced and no network. */
export async function createTestServer(options: TestServerOptions = {}): Promise<TestContext> {
  const config: AppConfig = { ...DEFAULTS, databasePath: ':memory:', ...options.config };
  const db = openDatabase(':memory:');
  migrate(db);
  const store = new SqliteHistoryStore(db);
  const app = await buildServer({ config, db, store, logger: false });
  await app.ready();
  return { app, db, store, config };
}

/** Posts a form the way a browser does. */
export function postForm(app: FastifyInstance, url: string, fields: Record<string, string | string[]>): Promise<LightMyRequestResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      params.append(key, v);
    }
  }
  return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: params.toString() });
}
