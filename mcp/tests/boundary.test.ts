import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("MCP authority boundary", () => {
  it("contains no Server-internal or database dependency", async () => {
    const packageDocument = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(packageDocument.dependencies).not.toHaveProperty("pg");
    expect(packageDocument.dependencies).not.toHaveProperty("kysely");

    const sourceDirectory = new URL("../src/", import.meta.url);
    const sourceFiles = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".ts"));
    const sources = await Promise.all(sourceFiles.map(async (name) => ({
      name,
      content: await readFile(new URL(name, sourceDirectory), "utf8")
    })));
    for (const source of sources) {
      expect(source.content, source.name).not.toMatch(/(?:from|import\()["'][^"']*server\/src/u);
      expect(source.content, source.name).not.toMatch(/(?:from|import\()["'](?:pg|kysely)["']/u);
    }
  });
});
