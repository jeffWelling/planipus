import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import type pg from "pg";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/u;

export async function runMigrations(pool: pg.Pool, directory: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(706_108_707)");
    await client.query(`
      create table if not exists server_schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const files = (await readdir(resolve(directory))).filter((file) => MIGRATION_FILE.test(file)).sort();
    for (const file of files) {
      const body = await readFile(resolve(directory, file), "utf8");
      const checksum = createHash("sha256").update(body, "utf8").digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "select checksum from server_schema_migrations where name = $1",
        [file]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`applied migration ${file} has changed`);
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(body);
        await client.query(
          "insert into server_schema_migrations(name, checksum) values ($1, $2)",
          [file, checksum]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(706_108_707)").catch(() => undefined);
    client.release();
  }
}
