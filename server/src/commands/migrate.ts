import { loadConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { runMigrations } from "../database/migrate.js";
import { runMigrationsWithRetry } from "../database/startup.js";
import { reportFatal } from "../process.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  try {
    await runMigrationsWithRetry(
      async () => runMigrations(database.pool, config.migrationsDirectory),
      { attempts: config.migrationAttempts }
    );
  } finally {
    config.masterKey.fill(0);
    await database.close();
  }
}

void main().catch(reportFatal);
