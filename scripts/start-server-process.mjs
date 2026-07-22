import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const processName = process.argv[2];
const commands = {
  api: "server/dist/src/commands/api.js",
  scheduler: "server/dist/src/commands/scheduler.js",
  worker: "server/dist/src/commands/worker.js"
};

if (!Object.hasOwn(commands, processName)) {
  console.error("usage: node scripts/start-server-process.mjs <api|scheduler|worker>");
  process.exit(2);
}

try {
  const { loadConfig } = await import("../server/dist/src/config.js");
  const config = loadConfig();
  config.masterKey.fill(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let activeChild;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    activeChild?.kill(signal);
  });
}

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      activeChild = undefined;
      resolve({ code, signal });
    });
  });
}

const configuredAttempts = Number.parseInt(process.env.PLANIPUS_MIGRATION_ATTEMPTS ?? "30", 10);
const migrationAttempts = Number.isSafeInteger(configuredAttempts) && configuredAttempts > 0
  ? configuredAttempts
  : 30;

for (let attempt = 1; attempt <= migrationAttempts; attempt += 1) {
  if (stopping) {
    process.exit(0);
  }
  const result = await run("server/dist/src/commands/migrate.js");
  if (result.code === 0) {
    break;
  }
  if (stopping || result.signal) {
    process.exit(1);
  }
  if (attempt === migrationAttempts) {
    console.error(`database migrations failed after ${migrationAttempts} attempts`);
    process.exit(result.code ?? 1);
  }
  console.error(`database migrations unavailable (attempt ${attempt}/${migrationAttempts}); retrying in 2 seconds`);
  await delay(2_000);
}

if (stopping) {
  process.exit(0);
}

const result = await run(commands[processName]);
if (result.signal) {
  process.removeAllListeners(result.signal);
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.code ?? 1);
}
