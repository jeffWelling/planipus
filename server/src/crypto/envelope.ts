import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

export interface EncryptedEnvelope {
  readonly version: 1;
  readonly algorithm: "A256GCM";
  readonly key_id: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authentication_tag: string;
}

export interface EnvelopeKey {
  readonly id: string;
  readonly bytes: Buffer;
}

function assertKey(key: EnvelopeKey): void {
  if (key.bytes.length !== 32) {
    throw new Error("A256GCM envelope keys must contain exactly 32 bytes");
  }
}

export function encryptEnvelope(
  plaintext: Buffer | string,
  key: EnvelopeKey,
  authenticatedContext: string
): EncryptedEnvelope {
  assertKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
  cipher.setAAD(Buffer.from(authenticatedContext, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext),
    cipher.final()
  ]);
  return {
    version: 1,
    algorithm: "A256GCM",
    key_id: key.id,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authentication_tag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptEnvelope(
  envelope: EncryptedEnvelope,
  key: EnvelopeKey,
  authenticatedContext: string
): Buffer {
  assertKey(key);
  if (envelope.version !== 1 || envelope.algorithm !== "A256GCM" || envelope.key_id !== key.id) {
    throw new Error("unsupported or unavailable credential envelope key");
  }
  const nonce = Buffer.from(envelope.nonce, "base64");
  const tag = Buffer.from(envelope.authentication_tag, "base64");
  if (nonce.length !== 12 || tag.length !== 16) {
    throw new Error("malformed credential envelope");
  }
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, nonce);
  decipher.setAAD(Buffer.from(authenticatedContext, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]);
}

export function encryptJson<T>(value: T, key: EnvelopeKey, authenticatedContext: string): EncryptedEnvelope {
  return encryptEnvelope(JSON.stringify(value), key, authenticatedContext);
}

export function decryptJson<T>(envelope: EncryptedEnvelope, key: EnvelopeKey, authenticatedContext: string): T {
  return JSON.parse(decryptEnvelope(envelope, key, authenticatedContext).toString("utf8")) as T;
}

export function rewrapEnvelope(
  envelope: EncryptedEnvelope,
  oldKey: EnvelopeKey,
  newKey: EnvelopeKey,
  authenticatedContext: string
): EncryptedEnvelope {
  const plaintext = decryptEnvelope(envelope, oldKey, authenticatedContext);
  try {
    return encryptEnvelope(plaintext, newKey, authenticatedContext);
  } finally {
    plaintext.fill(0);
  }
}

export function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
