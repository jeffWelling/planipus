import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const command = process.argv[2];

const steps = {
  build: [
    ["run", "build", "--workspace", "@planipus/calendar-sync"],
    ["run", "build", "--workspace", "@planipus/server"],
    ["run", "build", "--workspace", "@planipus/web"],
    ["run", "build", "--workspace", "@planipus/mcp"]
  ],
  typecheck: [
    ["run", "typecheck", "--workspace", "@planipus/calendar-sync"],
    // The server consumes the shared package through its public dist export.
    // Emit it first so this command also works immediately after `npm ci`.
    ["run", "build", "--workspace", "@planipus/calendar-sync"],
    ["run", "typecheck", "--workspace", "@planipus/server"],
    ["run", "typecheck", "--workspace", "@planipus/web"],
    ["run", "typecheck", "--workspace", "@planipus/mcp"]
  ],
  test: [
    // Server tests load the shared package's JavaScript export.
    ["run", "build", "--workspace", "@planipus/calendar-sync"],
    ["run", "test", "--workspace", "@planipus/calendar-sync"],
    ["run", "test", "--workspace", "@planipus/server"],
    ["run", "test", "--workspace", "@planipus/mcp"]
  ]
};

if (!Object.hasOwn(steps, command)) {
  console.error("usage: node scripts/workspace-command.mjs <build|typecheck|test>");
  process.exit(2);
}

for (const args of steps[command]) {
  const result = spawnSync(npm, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
