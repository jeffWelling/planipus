import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const casesRoot = join(root, "cases");

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }));
  return nested.flat();
}

const manifestCases = [];
for (const path of await jsonFiles(casesRoot)) {
  const bundle = JSON.parse(await readFile(path, "utf8"));
  for (const fixture of bundle.cases) {
    manifestCases.push({
      case_id: fixture.case_id,
      kind: bundle.kind,
      path: relative(root, path).split("\\").join("/"),
      requirements: [...fixture.requirements].sort(),
    });
  }
}

manifestCases.sort((left, right) => left.case_id.localeCompare(right.case_id));
const ids = new Set(manifestCases.map(({ case_id }) => case_id));
if (ids.size !== manifestCases.length) throw new Error("Duplicate conformance case ID");
if (manifestCases.length < 60) throw new Error(`Expected at least 60 cases, found ${manifestCases.length}`);

await writeFile(
  join(root, "manifest.json"),
  `${JSON.stringify({ contract_version: 1, cases: manifestCases }, null, 2)}\n`,
  "utf8",
);
