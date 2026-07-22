import { createHash, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

export const PERSONAL_ORGANIZATION_ID = "00000000-0000-7000-8000-000000000001";
export const OWNER_PRINCIPAL_ID = "00000000-0000-7000-8000-000000000002";

export function newId(): string {
  return uuidv7();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code.toLowerCase().replace(/[^a-z0-9_:-]/gu, "_").slice(0, 80);
  }
  return error instanceof Error ? error.name.toLowerCase().slice(0, 80) : "unknown_error";
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}
