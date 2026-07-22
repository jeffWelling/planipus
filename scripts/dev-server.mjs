import { spawnSync, spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const workspace of ["@planipus/calendar-sync", "@planipus/server", "@planipus/web"]) {
  const result = spawnSync(npm, ["run", "build", "--workspace", workspace], {
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

const children = ["api", "scheduler", "worker"].map((processName) => spawn(
  process.execPath,
  ["scripts/start-server-process.mjs", processName],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  }
));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => children.forEach((child) => child.kill(signal)));
}

let exiting = false;
for (const child of children) {
  child.on("error", (error) => { throw error; });
  child.on("exit", (code, signal) => {
    if (exiting) return;
    exiting = true;
    children.filter((candidate) => candidate !== child).forEach((candidate) => candidate.kill("SIGTERM"));
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 1);
    }
  });
}
