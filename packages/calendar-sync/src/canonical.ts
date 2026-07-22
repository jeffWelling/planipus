import { createHash } from "node:crypto";
import type { JsonValue } from "./types.js";

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not support non-finite numbers");
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("Planipus canonical JSON permits safe integers only");
  }
  const rendered = JSON.stringify(value);
  if (rendered === undefined) throw new TypeError("Number could not be serialized");
  return rendered;
}

export function canonicalizeJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
  }

  const normalizedEntries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .map(([key, member]) => [key.normalize("NFC"), member] as const);
  if (new Set(normalizedEntries.map(([key]) => key)).size !== normalizedEntries.length) {
    throw new TypeError("Canonical JSON object contains NFC-equivalent duplicate keys");
  }
  const members = normalizedEntries
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalizeJson(member)}`);
  return `{${members.join(",")}}`;
}

export function sha256Canonical(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
}
