import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = [repository, join(repository, "docs")];
const ignoredDirectories = new Set([".git", ".build", "dist", "node_modules", "spikes"]);

async function* markdownFiles(directory, recursive) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && recursive && !ignoredDirectories.has(entry.name)) {
      yield* markdownFiles(path, true);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      yield path;
    }
  }
}

const markdown = new Set();
for (const root of roots) {
  for await (const path of markdownFiles(root, root.endsWith("docs"))) {
    markdown.add(path);
  }
}

const failures = [];
const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const path of markdown) {
  const contents = await readFile(path, "utf8");
  for (const match of contents.matchAll(linkPattern)) {
    const rawTarget = match[1]?.trim();
    if (!rawTarget || /^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
    const targetWithoutTitle = rawTarget.startsWith("<")
      ? rawTarget.slice(1, rawTarget.indexOf(">"))
      : rawTarget.split(/\s+["']/u, 1)[0];
    const target = decodeURIComponent((targetWithoutTitle ?? "").split("#", 1)[0] ?? "");
    if (!target) continue;
    try {
      await access(resolve(dirname(path), target));
    } catch {
      failures.push(`${path}: missing local link ${target}`);
    }
  }
}

const requirementsPath = join(repository, "docs", "REQUIREMENTS.md");
const traceabilityPath = join(repository, "docs", "TRACEABILITY.md");
const requirementsText = await readFile(requirementsPath, "utf8");
const traceabilityText = await readFile(traceabilityPath, "utf8");
const requirementIds = [...requirementsText.matchAll(/^\| ([A-Z]+-\d{3}) \|/gmu)].map((match) => match[1]);
for (const id of requirementIds) {
  if (id && !traceabilityText.includes(`| ${id} |`)) {
    failures.push(`docs/TRACEABILITY.md: missing ${id}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`docs gate: passed (${markdown.size} Markdown files, ${requirementIds.length} requirements)`);
}
