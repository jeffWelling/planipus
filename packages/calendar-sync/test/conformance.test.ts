import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  evaluateHours,
  evaluatePolicy,
  sha256Canonical,
  type HoursEvaluationInput,
  type JsonValue,
  type PolicyEvaluationInput,
  type PolicyEvaluationResult,
} from "../src/index.js";

type JsonObject = Record<string, JsonValue>;

interface ManifestEntry {
  case_id: string;
  kind: "hours_evaluation" | "policy_evaluation" | "validation";
  path: string;
  requirements: string[];
}

interface Manifest {
  contract_version: 1;
  cases: ManifestEntry[];
}

interface FixtureCase {
  case_id: string;
  title: string;
  requirements: string[];
  input_patch: JsonObject;
  expected: JsonObject;
}

interface FixtureBundle {
  contract_version: 1;
  kind: ManifestEntry["kind"];
  defaults: { input: JsonObject };
  cases: FixtureCase[];
}

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const contractRoot = resolve(packageDirectory, "../../conformance/calendar-sync/v1");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function listJsonFiles(relativeDirectory: string): Promise<string[]> {
  const entries = await readdir(resolve(contractRoot, relativeDirectory), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await listJsonFiles(relativePath));
    else if (entry.isFile() && entry.name.endsWith(".json")) paths.push(relativePath);
  }
  return paths.sort();
}

function mergePatch(target: JsonValue, patch: JsonValue): JsonValue {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return structuredClone(patch);
  }
  const source: JsonObject = target !== null && typeof target === "object" && !Array.isArray(target)
    ? structuredClone(target)
    : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete source[key];
    else source[key] = mergePatch(source[key] ?? null, value);
  }
  return source;
}

function expectIncluded<T>(actual: T[], expected: JsonValue | undefined): void {
  if (expected === undefined) return;
  for (const value of expected as unknown as T[]) expect(actual).toContain(value);
}

function assertHours(actual: ReturnType<typeof evaluateHours>, expected: JsonObject): void {
  expect(actual.included).toBe(expected["included"]);
  expect(actual.reason_code).toBe(expected["reason_code"]);
  if (expected["matched_intervals"] !== undefined) {
    expect(actual.matched_intervals).toEqual(expected["matched_intervals"]);
  }
  expectIncluded(actual.diagnostics, expected["diagnostics_include"]);
}

function assertPolicy(
  actual: PolicyEvaluationResult,
  expected: JsonObject,
  validateDesired: ValidateFunction,
  validateDisclosure: ValidateFunction,
): void {
  expect(actual.selection).toBe(expected["selection"]);
  expect(actual.operation).toBe(expected["operation"]);
  expect(actual.primary_reason_code).toBe(expected["primary_reason_code"]);
  expectIncluded(actual.reason_codes, expected["reason_codes_include"]);
  expectIncluded(actual.warnings, expected["warnings_include"]);

  if (expected["desired_timing"] !== undefined) {
    expect(actual.desired_copy?.timing).toEqual(expected["desired_timing"]);
  }
  if (expected["desired_transparency"] !== undefined) {
    expect(actual.desired_copy?.transparency).toBe(expected["desired_transparency"]);
  }
  if (expected["desired_fields"] !== undefined) {
    expect(actual.desired_copy).toBeDefined();
    for (const [field, value] of Object.entries(expected["desired_fields"] as JsonObject)) {
      expect((actual.desired_copy as unknown as JsonObject)[field]).toEqual(value);
    }
  }
  if (expected["desired_absent_fields"] !== undefined) {
    const desired = (actual.desired_copy ?? {}) as unknown as JsonObject;
    for (const field of expected["desired_absent_fields"] as string[]) {
      expect(Object.hasOwn(desired, field)).toBe(false);
    }
  }
  if (expected["disclosed_fields_include"] !== undefined) {
    expect(actual.disclosure_manifest).toBeDefined();
    expectIncluded(
      actual.disclosure_manifest?.source_fields_disclosed ?? [],
      expected["disclosed_fields_include"],
    );
  }
  if (expected["forbidden_values"] !== undefined) {
    const rendered = canonicalizeJson(actual as unknown as JsonValue);
    for (const forbidden of expected["forbidden_values"] as string[]) {
      expect(rendered).not.toContain(forbidden.normalize("NFC"));
    }
  }

  if (actual.desired_copy !== undefined) {
    expect(validateDesired(actual.desired_copy), JSON.stringify(validateDesired.errors)).toBe(true);
    expect(validateDisclosure(actual.disclosure_manifest), JSON.stringify(validateDisclosure.errors)).toBe(true);
    expect(actual.desired_copy.reminders).toEqual([]);
    expect(actual.desired_copy.write_controls.send_notifications).toBe(false);
    expect(actual.desired_fingerprint).toBe(sha256Canonical(actual.desired_copy as unknown as JsonValue));
  }
}

describe("Calendar Sync conformance v1", async () => {
  const manifest = await readJson<Manifest>(resolve(contractRoot, "manifest.json"));
  const awaitedCaseBundlePaths = await listJsonFiles("cases");
  const manifestSchema = await readJson<JsonObject>(resolve(contractRoot, "schemas/manifest.schema.json"));
  const bundleSchema = await readJson<JsonObject>(resolve(contractRoot, "schemas/case-bundle.schema.json"));
  const hoursSchema = await readJson<JsonObject>(resolve(contractRoot, "schemas/hours-evaluation.schema.json"));
  const policySchema = await readJson<JsonObject>(resolve(contractRoot, "schemas/policy-evaluation.schema.json"));
  const desiredSchema = await readJson<JsonObject>(resolve(contractRoot, "schemas/desired-copy.schema.json"));
  const disclosureSchema = await readJson<JsonObject>(resolve(contractRoot, "schemas/disclosure-manifest.schema.json"));
  const reasonRegistry = await readJson<{ entries: { id: string }[] }>(resolve(contractRoot, "registries/reason-codes.json"));
  const privacyRegistry = await readJson<{ entries: { id: string; version: number }[] }>(resolve(contractRoot, "registries/privacy-presets.json"));
  const reasonCodes = new Set(reasonRegistry.entries.map(({ id }) => id));
  const privacyVersions = new Set(privacyRegistry.entries.map(({ id, version }) => `${id}@${version}`));

  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  const validateManifest = ajv.compile(manifestSchema);
  const validateBundle = ajv.compile(bundleSchema);
  const validateHours = ajv.compile(hoursSchema);
  const validatePolicy = ajv.compile(policySchema);
  const validateDesired = ajv.compile(desiredSchema);
  const validateDisclosure = ajv.compile(disclosureSchema);

  it("has a valid manifest with at least sixty unique cases", () => {
    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true);
    expect(manifest.cases.length).toBeGreaterThanOrEqual(60);
    expect(new Set(manifest.cases.map(({ case_id }) => case_id)).size).toBe(manifest.cases.length);
    expect([...manifest.cases].map(({ case_id }) => case_id)).toEqual(
      [...manifest.cases].map(({ case_id }) => case_id).sort(),
    );
  });

  const bundles = new Map<string, FixtureBundle>();
  for (const entry of manifest.cases) {
    if (!bundles.has(entry.path)) {
      bundles.set(entry.path, await readJson<FixtureBundle>(resolve(contractRoot, entry.path)));
    }
  }

  it("lists every fixture exactly once", () => {
    expect([...bundles.keys()].sort()).toEqual(awaitedCaseBundlePaths);
    const bundled = [...bundles.entries()].flatMap(([path, bundle]) => {
      expect(validateBundle(bundle), `${path}: ${JSON.stringify(validateBundle.errors)}`).toBe(true);
      return bundle.cases.map((fixture) => ({ case_id: fixture.case_id, path }));
    });
    expect(bundled.sort((a, b) => a.case_id.localeCompare(b.case_id))).toEqual(
      manifest.cases.map(({ case_id, path }) => ({ case_id, path })),
    );
  });

  for (const entry of manifest.cases) {
    const bundle = bundles.get(entry.path);
    if (bundle === undefined) throw new Error(`Missing bundle ${entry.path}`);
    const fixture = bundle.cases.find(({ case_id }) => case_id === entry.case_id);
    if (fixture === undefined) throw new Error(`Missing fixture ${entry.case_id}`);

    it(`${entry.case_id}: ${fixture.title}`, () => {
      expect(bundle.kind).toBe(entry.kind);
      expect(fixture.requirements).toEqual(entry.requirements);
      const input = mergePatch(bundle.defaults.input, fixture.input_patch) as JsonObject;
      if (bundle.kind === "hours_evaluation") {
        expect(validateHours(input), JSON.stringify(validateHours.errors)).toBe(true);
        assertHours(evaluateHours(input as unknown as HoursEvaluationInput), fixture.expected);
        return;
      }

      expect(validatePolicy(input), JSON.stringify(validatePolicy.errors)).toBe(true);
      const original = structuredClone(input);
      const policyInput = input as unknown as PolicyEvaluationInput;
      const actual = evaluatePolicy(policyInput);
      expect(input).toEqual(original);
      assertPolicy(actual, fixture.expected, validateDesired, validateDisclosure);
      expect(reasonCodes.has(actual.primary_reason_code)).toBe(true);
      for (const code of actual.reason_codes) expect(reasonCodes.has(code)).toBe(true);
      for (const code of actual.warnings) expect(reasonCodes.has(code)).toBe(true);
      expect(privacyVersions.has(`${policyInput.policy.privacy.preset}@${policyInput.policy.privacy.preset_version}`)).toBe(true);
    });
  }
});
