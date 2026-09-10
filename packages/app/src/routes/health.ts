/**
 * Health endpoint (BC-047): success only when the database file is readable
 * and writable and a write lock can be taken.
 */
import { accessSync, constants } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/connection.js';

export interface HealthReport {
  status: 'ok' | 'error';
  database: string;
  failed?: 'file-access' | 'write-lock';
  message?: string;
}

export function checkHealth(db: Database, databasePath: string): HealthReport {
  if (databasePath !== ':memory:') {
    try {
      accessSync(databasePath, constants.R_OK | constants.W_OK);
    } catch (error) {
      return { status: 'error', database: databasePath, failed: 'file-access', message: String(error) };
    }
  }
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
  } catch (error) {
    return { status: 'error', database: databasePath, failed: 'write-lock', message: String(error) };
  }
  return { status: 'ok', database: databasePath };
}

export function registerHealthRoute(app: FastifyInstance, db: Database, databasePath: string): void {
  app.get('/healthz', async (_request, reply) => {
    const report = checkHealth(db, databasePath);
    return reply.code(report.status === 'ok' ? 200 : 503).send(report);
  });
}
