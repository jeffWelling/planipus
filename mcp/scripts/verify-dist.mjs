import { access, readdir } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const requiredEntrypoints = [
  "src/api-client.js",
  "src/config.js",
  "src/server.js",
  "src/stdio.js"
];

await Promise.all(requiredEntrypoints.map(async (entrypoint) => access(new URL(entrypoint, dist))));

const emitted = (await readdir(dist, { recursive: true }))
  .map((path) => path.replaceAll("\\", "/"));
const forbidden = emitted.filter((path) => (
  path.startsWith("tests/")
  || path.includes("/tests/")
  || /(^|\/)vitest\.config(?:\.|$)/u.test(path)
  || /\.test\.(?:js|d\.ts)(?:\.map)?$/u.test(path)
));

if (forbidden.length > 0) {
  throw new Error(`MCP production artifact contains test output:\n${forbidden.join("\n")}`);
}

console.log(`mcp artifact: passed (${emitted.length} emitted paths, no test/Vitest output)`);
