export const DEFAULT_FAKE_ACCESS_TOKEN = "fake-access-token";

export function fakeAccessTokenForConnection(connectionId: string): string {
  return `${DEFAULT_FAKE_ACCESS_TOKEN}:${connectionId}`;
}
