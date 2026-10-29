import { compareVersions, MIN_VERSION, parseVersion } from './version';

export type ConnectionResult =
  | { ok: true; version: string; detail?: string }
  | { ok: false; reason: 'unreachable' | 'unauthorized' | 'forbidden-scope' | 'too-old' | 'unknown'; detail?: string };

export const VENDOR_ACCEPT = 'application/vnd.manyfold.v0+json';

/** The scopes the extension needs (README and store listing): read lookups, write metadata, upload files. */
export const REQUIRED_SCOPES = ['read', 'write', 'upload'] as const;

export const DEFAULT_TIMEOUT_MS = 10_000;

export type HasPermission = (origin: string) => Promise<boolean>;

const chromeHasPermission: HasPermission = (origin) => chrome.permissions.contains({ origins: [`${origin}/*`] });

export class ManyfoldClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly hasPermission: HasPermission = chromeHasPermission,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Authenticated API request to `baseUrl + path` with the vendor Accept and bearer headers.
   * `timeoutMs` overrides the client default (e.g. for large upload chunks). An `init.signal` (e.g. the user's
   * cancel) is combined with the timeout. Cookies are never sent (credentials: 'omit'), so auth is the token alone.
   */
  request(path: string, init: RequestInit = {}, timeoutMs: number = this.timeoutMs): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', VENDOR_ACCEPT);
    headers.set('Authorization', `Bearer ${this.token}`);
    // The caller's signal (cancel) and the timeout both apply; the reason is whichever fired first.
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal, credentials: 'omit' });
  }

  /**
   * Verifies the token itself via Doorkeeper's token info endpoint (GET /oauth/token/info), which answers 401 for a
   * missing, invalid, revoked or expired token even when the server allows public browsing, and lists the token's
   * scopes. Only if that response carries no usable scope list does it fall back to probing GET /models and
   * OPTIONS /upload. Then it reads the version from NodeInfo. Manyfold exposes its version only via NodeInfo, which
   * exists only when federation is enabled, so the minimum-version check is best-effort: without NodeInfo the result
   * is { ok: true, version: 'unknown' }.
   */
  async testConnection(): Promise<ConnectionResult> {
    try {
      if (!(await this.hasPermission(new URL(this.baseUrl).origin))) {
        return { ok: false, reason: 'unreachable', detail: 'Permission to access this Manyfold server was revoked. Save settings again to re-grant it.' };
      }
    } catch {
      return { ok: false, reason: 'unreachable', detail: 'Could not check permission for this Manyfold server.' };
    }

    try {
      const info = await this.request('/oauth/token/info');
      if (info.status === 401) {
        return { ok: false, reason: 'unauthorized', detail: 'It may have been revoked, expired or mistyped, so paste a new one. If the token is new, a reverse proxy may be dropping the Authorization header.' };
      }
      if (!info.ok) return { ok: false, reason: 'unknown', detail: `Unexpected response ${info.status} for the token check (GET /oauth/token/info).` };

      const scopes = parseScopes(await info.json().catch(() => undefined));
      let uploadNote: string | undefined;
      if (scopes) {
        const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
        if (missing.length) return { ok: false, reason: 'forbidden-scope', detail: `The token lacks the ${missing.join(', ')} scope${missing.length > 1 ? 's' : ''}.` };
      } else {
        // The scope list is unavailable, so verify access the older way.
        const models = await this.request('/models');
        const bad = statusToFailure(models.status, 'read access (GET /models)');
        if (bad) return bad;

        // Only 401/403/2xx are conclusive: Rails may have no OPTIONS route, so 404/405/etc. says nothing.
        const upload = await this.request('/upload', { method: 'OPTIONS' });
        const badUpload = upload.status === 401 || upload.status === 403 ? statusToFailure(upload.status, 'the upload scope (OPTIONS /upload)') : undefined;
        if (badUpload) return badUpload;
        uploadNote = upload.ok ? undefined : 'The upload endpoint could not be probed, so upload access is unverified.';
      }

      const version = await this.detectVersion();
      if (version && compareVersions(version, MIN_VERSION) < 0) {
        return { ok: false, reason: 'too-old', detail: `Manyfold ${version} found; ${MIN_VERSION} or newer is required.` };
      }
      return uploadNote ? { ok: true, version: version ?? 'unknown', detail: uploadNote } : { ok: true, version: version ?? 'unknown' };
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        return { ok: false, reason: 'unreachable', detail: 'The connection timed out.' };
      }
      return { ok: false, reason: 'unreachable', detail: 'Could not reach the Manyfold server.' };
    }
  }

  private async detectVersion(): Promise<string | undefined> {
    try {
      const res = await this.request('/nodeinfo/2.0');
      if (!res.ok) return undefined;
      const raw = ((await res.json()) as { software?: { version?: unknown } }).software?.version;
      if (typeof raw !== 'string' || !parseVersion(raw)) return undefined;
      return raw.trim().replace(/^v/, '');
    } catch {
      return undefined;
    }
  }
}

/** Token info's `scope` as a list: an array, a space-separated string, or Doorkeeper's `{ scopes: [...] }`. */
function parseScopes(body: unknown): string[] | undefined {
  const scope = (body as { scope?: unknown } | null | undefined)?.scope;
  const list = typeof scope === 'string' ? scope.split(/\s+/).filter(Boolean) : Array.isArray(scope) ? scope : (scope as { scopes?: unknown } | null | undefined)?.scopes;
  if (typeof list === 'string') return parseScopes({ scope: list });
  return Array.isArray(list) && list.every((x) => typeof x === 'string') ? (list as string[]) : undefined;
}

function statusToFailure(status: number, what: string): ConnectionResult | undefined {
  if (status === 401) return { ok: false, reason: 'unauthorized', detail: 'It may have been revoked, expired or mistyped, so paste a new one.' };
  if (status === 403) return { ok: false, reason: 'forbidden-scope', detail: `The token lacks ${what}.` };
  if (status >= 400) return { ok: false, reason: 'unknown', detail: `Unexpected response ${status} for ${what}.` };
  return undefined;
}
