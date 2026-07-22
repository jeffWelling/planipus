import { spawnSync } from "node:child_process";

const checks = [
  [process.execPath, ["scripts/provenance-gate.mjs"]],
  [process.execPath, ["scripts/docs-gate.mjs"]],
  [process.execPath, ["scripts/workspace-command.mjs", "typecheck"]],
  [process.execPath, ["scripts/workspace-command.mjs", "test"]],
  [process.execPath, ["scripts/workspace-command.mjs", "build"]]
];

for (const [executable, args] of checks) {
  const result = spawnSync(executable, args, {
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
