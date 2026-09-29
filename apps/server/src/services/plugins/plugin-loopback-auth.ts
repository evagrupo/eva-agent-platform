import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createRequestTimeoutFetch,
  DEFAULT_BB_REQUEST_TIMEOUT_MS,
  type FetchImplementation,
} from "@bb/sdk";

export const PLUGIN_LOOPBACK_AUTH_HEADER = "x-bb-plugin-loopback";

export function createPluginLoopbackSecret(): Buffer {
  return randomBytes(32);
}

export function pluginLoopbackHeaderValue(secret: Buffer): string {
  return secret.toString("hex");
}

export function requestHasPluginLoopbackAuth(
  request: Request,
  secret: Buffer,
): boolean {
  const header = request.headers.get(PLUGIN_LOOPBACK_AUTH_HEADER);
  if (header === null) return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(pluginLoopbackHeaderValue(secret));
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function createPluginLoopbackFetch(
  secret: Buffer,
  fetchImpl: FetchImplementation = createRequestTimeoutFetch({
    timeoutMs: DEFAULT_BB_REQUEST_TIMEOUT_MS,
  }),
): FetchImplementation {
  const token = pluginLoopbackHeaderValue(secret);
  return (input, init) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, name) => {
      headers.set(name, value);
    });
    headers.set(PLUGIN_LOOPBACK_AUTH_HEADER, token);
    if (input instanceof Request) {
      return fetchImpl(new Request(input, { ...init, headers }));
    }
    return fetchImpl(input, { ...init, headers });
  };
}
