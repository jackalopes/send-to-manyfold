import { linkSearch, modelKey } from '../adapters/model-keys';
import type { ManyfoldClient } from './client';
import { toPath } from './paths';

/** Most candidates followed. `GET /models?link=` on a server that predates the filter returns every model. */
export const MAX_CANDIDATES = 10;

export interface FoundModel {
  /** Manyfold's public id (last path segment of the model). */
  id: string;
  name: string;
  /** The model's page in the Manyfold web app. */
  url: string;
}

export type LookupResult =
  | { status: 'found'; models: FoundModel[]; /** Manyfold's model list filtered by the same link text. */ listUrl: string }
  | { status: 'none' }
  | {
      status: 'unknown';
      /**
       * `unsupported`: not a supported model page (no request made); `unauthorized` / `forbidden`: 401 / 403;
       * `too-many`: more than MAX_CANDIDATES matched, so the server probably ignores `link`; `aborted`: the signal
       * fired; `error`: network error, timeout, other non-2xx or an unreadable response.
       */
      reason: 'unsupported' | 'unauthorized' | 'forbidden' | 'too-many' | 'aborted' | 'error';
    };

class LookupFailed extends Error {
  constructor(readonly reason: Extract<LookupResult, { status: 'unknown' }>['reason']) {
    super(reason);
  }
}

async function getJson(client: ManyfoldClient, path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await client.request(path, { signal });
  if (res.status === 401) throw new LookupFailed('unauthorized');
  if (res.status === 403) throw new LookupFailed('forbidden');
  if (!res.ok) throw new LookupFailed('error');
  const body: unknown = await res.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new LookupFailed('error');
  return body as Record<string, unknown>;
}

/**
 * Asks Manyfold whether the model page at `pageUrl` is already saved, by the links its models carry. The server's
 * `link` filter is a substring match, so each candidate is fetched and kept only if one of its links has the same
 * `modelKey`. Never throws; the first page of results is all that is read.
 */
export async function lookupModel(client: ManyfoldClient, pageUrl: string, signal?: AbortSignal): Promise<LookupResult> {
  const key = modelKey(pageUrl);
  const search = linkSearch(pageUrl);
  if (!key || !search) return { status: 'unknown', reason: 'unsupported' };

  const listPath = `/models?link=${encodeURIComponent(search)}`;
  try {
    const list = await getJson(client, listPath, signal);
    const members = list.member;
    if (typeof list.totalItems !== 'number' || !Array.isArray(members)) throw new LookupFailed('error');
    if (list.totalItems > MAX_CANDIDATES || members.length > MAX_CANDIDATES) throw new LookupFailed('too-many');

    const checked = await Promise.all(
      members.map(async (member): Promise<FoundModel | undefined> => {
        const ref = (member as { '@id'?: unknown } | null)?.['@id'];
        if (typeof ref !== 'string') throw new LookupFailed('error');
        const path = toPath(client, ref);
        const detail = await getJson(client, path, signal);
        const links = Array.isArray(detail.links) ? detail.links : [];
        const same = links.some((l) => typeof (l as { url?: unknown } | null)?.url === 'string' && modelKey((l as { url: string }).url) === key);
        if (!same) return undefined;
        const name = typeof detail.name === 'string' ? detail.name : '';
        return { id: path.split('?')[0]!.split('/').filter(Boolean).pop()!, name, url: `${client.baseUrl}${path}` };
      }),
    );
    const models = checked.filter((m): m is FoundModel => !!m);
    return models.length ? { status: 'found', models, listUrl: `${client.baseUrl}${listPath}` } : { status: 'none' };
  } catch (e) {
    if (e instanceof LookupFailed) return { status: 'unknown', reason: e.reason };
    return { status: 'unknown', reason: signal?.aborted ? 'aborted' : 'error' };
  }
}
