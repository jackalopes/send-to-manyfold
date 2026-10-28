import type { LookupResult } from '../manyfold/lookup';
import { connectionFromSettings, type ConnectionSettings } from './connection';

export interface ModelLookupDeps {
  loadSettings(): Promise<ConnectionSettings>;
  hasPermission(baseUrl: string): Promise<boolean>;
  /** The real lookup against a connection (`lookupModel` with a `ManyfoldClient`). */
  run(connection: { baseUrl: string; token: string }, pageUrl: string, signal?: AbortSignal): Promise<LookupResult>;
}

/**
 * "Is this model page already in Manyfold?" for the background: reads the saved settings and checks the host
 * permission first, so with no settings or no permission it answers `unknown` without any request.
 */
export function createModelLookup(deps: ModelLookupDeps) {
  return async (pageUrl: string, signal?: AbortSignal): Promise<LookupResult> => {
    const conn = await connectionFromSettings(deps.loadSettings, deps.hasPermission);
    if (!conn.ok) return { status: 'unknown', reason: 'error' };
    try {
      return await deps.run({ baseUrl: conn.baseUrl, token: conn.token }, pageUrl, signal);
    } catch {
      return { status: 'unknown', reason: 'error' };
    }
  };
}
