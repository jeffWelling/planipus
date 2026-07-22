import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { DatabaseSchema } from "./types.js";

const { Pool } = pg;

export interface DatabaseHandle {
  readonly db: Kysely<DatabaseSchema>;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
    application_name: "planipus-server"
  });
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool })
  });
  return {
    db,
    pool,
    async close(): Promise<void> {
      await db.destroy();
    }
  };
}
