/**
 * The host-permission match pattern for the user's Manyfold. Chrome takes the exact origin, port included.
 * Firefox does not apply a runtime grant with a port to CORS for extension fetches (sends then fail as
 * unreachable even though `permissions.contains` answers true), so there the port is dropped.
 * Throws on a URL that cannot be parsed.
 */
export function manyfoldOriginPattern(
  baseUrl: string,
  firefox: boolean,
): string {
  const url = new URL(baseUrl);
  return firefox ? `${url.protocol}//${url.hostname}/*` : `${url.origin}/*`;
}
