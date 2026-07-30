export interface ProviderCalendarIdentityInput {
  readonly provider: string;
  readonly connection_id: string;
  readonly remote_id: string;
}

/**
 * Canonical identity for an underlying provider calendar. Google calendar IDs
 * are global across delegated connections; providers without that guarantee
 * remain scoped to the local connection. Length-prefixing prevents delimiter
 * ambiguity for provider-controlled identifiers.
 */
export function providerCalendarIdentity(calendar: ProviderCalendarIdentityInput): string {
  const scope = calendar.provider === "google" ? "global" : calendar.connection_id;
  return [calendar.provider, scope, calendar.remote_id]
    .map((component) => `${Buffer.byteLength(component, "utf8")}:${component}`)
    .join("");
}

export function providerCalendarProtectionKey(identity: string): string {
  return `provider-calendar:${identity}`;
}
