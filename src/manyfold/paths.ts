import type { ManyfoldClient } from './client';

/**
 * Server path (+ query) of an id or URL. Manyfold builds absolute `@id`s from its configured public host, which
 * may differ from the address the extension uses, so only the path is kept. A path prefix of `baseUrl` (Manyfold
 * served under a sub-path) is removed, because `request()` adds it back.
 */
export function toPath(client: ManyfoldClient, idOrUrl: string): string {
  const u = new URL(idOrUrl, 'http://x/');
  const prefix = new URL(client.baseUrl).pathname.replace(/\/+$/, '');
  const path = prefix && u.pathname.startsWith(`${prefix}/`) ? u.pathname.slice(prefix.length) : u.pathname;
  return `${path}${u.search}`;
}

/** A collection given as a bare id, a server path (`/collections/abc`, what the pickers send) or a URL, as a server path. */
export function collectionPath(client: ManyfoldClient, id: string): string {
  return /^https?:\/\//i.test(id) || id.startsWith('/') ? toPath(client, id) : `/collections/${encodeURIComponent(id)}`;
}

/** The absolute URL Manyfold expects in `isPartOf`. */
export function collectionUrl(client: ManyfoldClient, id: string): string {
  return `${client.baseUrl}${collectionPath(client, id)}`;
}
