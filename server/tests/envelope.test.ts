import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  decryptEnvelope,
  encryptEnvelope,
  equalSecret,
  rewrapEnvelope,
  type EnvelopeKey
} from "../src/crypto/envelope.js";

const key: EnvelopeKey = { id: "test-v1", bytes: Buffer.alloc(32, 11) };

describe("credential envelopes", () => {
  it("round-trips arbitrary UTF-8 and binds ciphertext to its record context", () => {
    fc.assert(fc.property(fc.string(), (plaintext) => {
      const encrypted = encryptEnvelope(plaintext, key, "provider_connection:one:google");
      expect(decryptEnvelope(encrypted, key, "provider_connection:one:google").toString("utf8"))
        .toBe(plaintext);
      expect(() => decryptEnvelope(encrypted, key, "provider_connection:two:google")).toThrow();
    }));
  });

  it("detects authentication-tag tampering", () => {
    const encrypted = encryptEnvelope("secret", key, "record:1");
    const tag = Buffer.from(encrypted.authentication_tag, "base64");
    tag[0] = (tag[0] ?? 0) ^ 1;
    expect(() => decryptEnvelope(
      { ...encrypted, authentication_tag: tag.toString("base64") },
      key,
      "record:1"
    )).toThrow();
  });

  it("rewraps under a new key and uses constant-time equality for equal-length values", () => {
    const next: EnvelopeKey = { id: "test-v2", bytes: Buffer.alloc(32, 19) };
    const original = encryptEnvelope("secret", key, "record:1");
    const rewrapped = rewrapEnvelope(original, key, next, "record:1");
    expect(decryptEnvelope(rewrapped, next, "record:1").toString("utf8")).toBe("secret");
    expect(equalSecret("same", "same")).toBe(true);
    expect(equalSecret("same", "nope")).toBe(false);
  });
});
