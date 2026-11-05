import type { ManyfoldClient } from './client';
import { FORBIDDEN_TEXT, ManyfoldError, UNAUTHORIZED_TEXT, UNREACHABLE_TEXT } from './errors';

/** Answers a proxy in front of a stopped Manyfold gives. */
export const isGatewayStatus = (status: number): boolean => status === 502 || status === 503 || status === 504;

/**
 * One quick request before a send downloads anything: `GET /oauth/token/info` answers 401 for a bad token even when
 * the server allows public browsing. Only conclusive results throw: no response (network error or timeout), a
 * gateway answer (502, 503, 504), 401 and 403. Any other answer (404 on an older Manyfold, a 500, 429 ...) says
 * nothing certain, so the send goes on and the real requests report what they find. A cancel rethrows as an abort.
 */
export async function checkManyfold(client: ManyfoldClient, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let res: Response;
  try {
    res = await client.request('/oauth/token/info', signal ? { signal } : {});
  } catch {
    signal?.throwIfAborted();
    throw new ManyfoldError('unreachable', UNREACHABLE_TEXT);
  }
  if (isGatewayStatus(res.status)) throw new ManyfoldError('unreachable', UNREACHABLE_TEXT);
  if (res.status === 401) throw new ManyfoldError('unauthorized', UNAUTHORIZED_TEXT);
  if (res.status === 403) throw new ManyfoldError('forbidden', FORBIDDEN_TEXT);
}
