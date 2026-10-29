export type PrefillField = 'title' | 'description' | 'creator' | 'license' | 'tags' | 'sourceUrl' | 'images';

export interface Settings {
  manyfoldUrl: string;
  token: string;
  prefill: Record<PrefillField, boolean>;
  defaultCollectionId?: string;
  defaultSensitive: boolean;
  includeImages: boolean;
}

const STORAGE_KEY = 'settings';

export const PREFILL_FIELDS: PrefillField[] = [
  'title', 'description', 'creator', 'license', 'tags', 'sourceUrl', 'images',
];

export function defaultSettings(): Settings {
  return {
    manyfoldUrl: '',
    token: '',
    prefill: Object.fromEntries(PREFILL_FIELDS.map((f) => [f, true])) as Record<PrefillField, boolean>,
    defaultSensitive: false,
    includeImages: true,
  };
}

const PRIVATE_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal'];

/** True for hosts where plain http is acceptable: IP literals (v4 or v6), localhost and common LAN-only suffixes. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** True when the saved URL would send the bearer token unencrypted to a host that is not private. */
export function isInsecurePublicUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:' && !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

function defaultScheme(input: string): 'http' | 'https' {
  try {
    return isPrivateHost(new URL(`http://${input}`).hostname) ? 'http' : 'https';
  } catch {
    return 'https';
  }
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('invalid-url');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${defaultScheme(trimmed)}://${trimmed}`;
  // WHATWG URL silently treats http:///x as http://x; reject the empty host instead.
  if (/^[a-z][a-z0-9+.-]*:\/\/\//i.test(withScheme)) throw new Error('invalid-url');
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('invalid-url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid-url');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export async function loadSettings(): Promise<Settings> {
  const defaults = defaultSettings();
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as Partial<Settings> | undefined;
  return {
    ...defaults,
    ...stored,
    prefill: { ...defaults.prefill, ...stored?.prefill },
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: s });
}

export function requestManyfoldPermission(baseUrl: string): Promise<boolean> {
  const { origin } = new URL(baseUrl);
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export type SaveResult = { ok: true } | { ok: false; reason: 'denied' | 'error'; message: string };

export interface SaveDeps {
  requestPermission: (baseUrl: string) => Promise<boolean>;
  save: (s: Settings) => Promise<void>;
}

const realDeps: SaveDeps = { requestPermission: requestManyfoldPermission, save: saveSettings };

/** Normalizes the URL, requests host permission, then saves. Permission must be requested first (user gesture). */
export async function saveWithPermission(s: Settings, deps: SaveDeps = realDeps): Promise<SaveResult> {
  let url: string;
  try {
    url = normalizeBaseUrl(s.manyfoldUrl);
  } catch {
    return { ok: false, reason: 'error', message: 'Enter a valid Manyfold URL.' };
  }
  try {
    if (!(await deps.requestPermission(url))) {
      return { ok: false, reason: 'denied', message: 'Permission to access your Manyfold server was denied; settings not saved.' };
    }
  } catch {
    return { ok: false, reason: 'error', message: 'Could not request permission for your Manyfold server.' };
  }
  try {
    await deps.save({ ...s, manyfoldUrl: url, token: s.token.trim(), defaultCollectionId: s.defaultCollectionId?.trim() || undefined });
  } catch {
    return { ok: false, reason: 'error', message: 'Could not save settings.' };
  }
  return { ok: true };
}
