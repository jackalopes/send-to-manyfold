import { createModelLookup, type ModelLookupDeps } from '../background/model-lookup';
import { loadSettings } from '../settings';
import { ManyfoldClient } from './client';
import { lookupModel } from './lookup';

/**
 * Whether the user still grants the extension access to the origin of `baseUrl`. Throws on a URL that cannot be
 * parsed (`connectionFromSettings` treats that as no permission).
 */
export const hostPermission =
  (contains: (permissions: { origins: string[] }) => Promise<boolean> = (p) => chrome.permissions.contains(p)) =>
  (baseUrl: string): Promise<boolean> =>
    contains({ origins: [`${new URL(baseUrl).origin}/*`] });

export interface BrowserLookupDeps extends Pick<ModelLookupDeps, 'loadSettings' | 'hasPermission'> {
  fetchImpl?: typeof fetch;
}

/**
 * The "already in Manyfold" lookup for the background and the popup alike: with no saved settings or no host
 * permission it answers `unknown` without a request; it never rejects.
 */
export function createBrowserLookup(deps: BrowserLookupDeps = { loadSettings, hasPermission: hostPermission() }) {
  return createModelLookup({
    loadSettings: deps.loadSettings,
    hasPermission: deps.hasPermission,
    run: (conn, pageUrl, signal) => lookupModel(new ManyfoldClient(conn.baseUrl, conn.token, deps.fetchImpl), pageUrl, signal),
  });
}
