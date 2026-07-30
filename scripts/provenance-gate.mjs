import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const rootPath = root.pathname;
const shippedRoots = ["conformance", "packages", "server", "web", "mcp", "macos", "deploy", "scripts"];
const rootManifests = ["package.json", "package-lock.json", "project.toml", "Procfile"];
const textExtensions = new Set([
  ".c",
  ".css",
  ".h",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".resolved",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml"
]);
const excludedNames = [
  ["kee", "per"].join(""),
  ["rida", "fkih"].join("")
];

async function* files(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (["dist", "node_modules", ".build"].includes(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* files(path);
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      yield path;
    }
  }
}

const failures = [];
for (const file of rootManifests) {
  const path = new URL(file, root).pathname;
  const contents = (await readFile(path, "utf8")).toLocaleLowerCase("en-US");
  for (const excludedName of excludedNames) {
    if (contents.includes(excludedName)) {
      failures.push(`${file} contains an excluded donor name`);
    }
  }
}

for (const shippedRoot of shippedRoots) {
  const directory = new URL(`${shippedRoot}/`, root).pathname;
  for await (const path of files(directory)) {
    const contents = (await readFile(path, "utf8")).toLocaleLowerCase("en-US");
    for (const excludedName of excludedNames) {
      if (contents.includes(excludedName)) {
        failures.push(`${relative(rootPath, path)} contains an excluded donor name`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("provenance gate: passed");
}
