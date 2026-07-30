import { createHmac } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@planipus/calendar-sync";

export interface PrivateAvailabilityHasher {
  hash(value: unknown): string;
}

/**
 * Keyed, domain-separated hashes prevent low-entropy private busy intervals
 * from being recovered by enumerating likely times against a stolen database
 * or backup. The derived key is independent from envelope-encryption use of
 * the installation master key.
 */
export class ConflictPrivacyHasher implements PrivateAvailabilityHasher {
  private readonly key: Buffer;

  public constructor(masterKey: Buffer) {
    this.key = createHmac("sha256", masterKey)
      .update("planipus:private-availability-hash:v1", "utf8")
      .digest();
  }

  public hash(value: unknown): string {
    return `hmac-sha256:${createHmac("sha256", this.key)
      .update(canonicalizeJson(value as JsonValue), "utf8")
      .digest("hex")}`;
  }

  public destroy(): void {
    this.key.fill(0);
  }
}
