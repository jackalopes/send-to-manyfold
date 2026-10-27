import { compareVersions, MIN_VERSION, parseVersion } from './version';

export type ConnectionResult =
  | { ok: true; version: string; detail?: string }
  | { ok: false; reason: 'unreachable' | 'unauthorized' | 'forbidden-scope' | 'too-old' | 'unknown'; detail?: string };

export const VENDOR_ACCEPT = 'application/vnd.manyfold.v0+json';

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
   * cancel) is combined with the timeout.
   */
  request(path: string, init: RequestInit = {}, timeoutMs: number = this.timeoutMs): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', VENDOR_ACCEPT);
    headers.set('Authorization', `Bearer ${this.token}`);
    // The caller's signal (cancel) and the timeout both apply; the reason is whichever fired first.
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers, signal });
  }

  /**
   * Probes auth/scope (GET /models), the upload API (OPTIONS /upload), then the version from NodeInfo.
   * Manyfold exposes its version only via NodeInfo, which exists only when federation is enabled, so the
   * minimum-version check is best-effort: without NodeInfo the result is { ok: true, version: 'unknown' }.
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
      const models = await this.request('/models');
      const bad = statusToFailure(models.status, 'read access (GET /models)');
      if (bad) return bad;

      // Only 401/403/2xx are conclusive: Rails may have no OPTIONS route, so 404/405/etc. says nothing.
      const upload = await this.request('/upload', { method: 'OPTIONS' });
      const badUpload = upload.status === 401 || upload.status === 403 ? statusToFailure(upload.status, 'the upload scope (OPTIONS /upload)') : undefined;
      if (badUpload) return badUpload;
      const uploadNote = upload.ok ? undefined : 'The upload endpoint could not be probed, so upload access is unverified.';

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

function statusToFailure(status: number, what: string): ConnectionResult | undefined {
  if (status === 401) return { ok: false, reason: 'unauthorized', detail: 'The token was rejected.' };
  if (status === 403) return { ok: false, reason: 'forbidden-scope', detail: `The token lacks ${what}.` };
  if (status >= 400) return { ok: false, reason: 'unknown', detail: `Unexpected response ${status} for ${what}.` };
  return undefined;
}
