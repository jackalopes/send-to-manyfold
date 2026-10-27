import { ManyfoldClient, type ConnectionResult } from './manyfold/client';
import { MIN_VERSION } from './manyfold/version';
import { normalizeBaseUrl, requestManyfoldPermission } from './settings';

export function describeResult(r: ConnectionResult): string {
  if (r.ok) {
    const base = r.version === 'unknown'
      ? `Connected. The Manyfold version could not be detected (it is only exposed when federation is enabled); Manyfold ${MIN_VERSION} or newer is required.`
      : `Connected to Manyfold ${r.version}.`;
    return r.detail ? `${base} ${r.detail}` : base;
  }
  const label = {
    unreachable: 'Could not connect', unauthorized: 'Token rejected', 'forbidden-scope': 'Token lacks a required scope',
    'too-old': 'Manyfold is too old', unknown: 'Unexpected response',
  }[r.reason];
  return r.detail ? `${label}: ${r.detail}` : label;
}

export interface TestDeps {
  requestPermission: (baseUrl: string) => Promise<boolean>;
  test: (baseUrl: string, token: string) => Promise<ConnectionResult>;
}

const realDeps: TestDeps = {
  requestPermission: requestManyfoldPermission,
  test: (url, token) => new ManyfoldClient(url, token).testConnection(),
};

export type ConnectionLevel = 'ok' | 'warning' | 'error';

/** A connection that worked but came with a detail (e.g. a scope that could not be checked) is a warning. */
export function connectionLevel(r: ConnectionResult): ConnectionLevel {
  if (!r.ok) return 'error';
  return r.detail ? 'warning' : 'ok';
}

/** Must be called directly from a click handler: permission is requested before any other await (user gesture). */
export async function runConnectionCheck(rawUrl: string, token: string, deps: TestDeps = realDeps): Promise<{ message: string; level: ConnectionLevel }> {
  let url: string;
  try {
    url = normalizeBaseUrl(rawUrl);
  } catch {
    return { message: 'Enter a valid Manyfold URL.', level: 'error' };
  }
  let granted: boolean;
  try {
    granted = await deps.requestPermission(url);
  } catch {
    return { message: 'Could not request permission for your Manyfold server.', level: 'error' };
  }
  if (!granted) return { message: 'Permission to access your Manyfold server was denied; cannot test the connection.', level: 'error' };
  const result = await deps.test(url, token);
  return { message: describeResult(result), level: connectionLevel(result) };
}

export async function runConnectionTest(rawUrl: string, token: string, deps: TestDeps = realDeps): Promise<string> {
  return (await runConnectionCheck(rawUrl, token, deps)).message;
}
