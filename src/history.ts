export interface HistoryEntry {
  sourceUrl: string;
  manyfoldUrl: string;
  at: number;
}

const STORAGE_KEY = 'sentHistory';
const MAX_ENTRIES = 1000;

/** Strips hash and tracking params; host case and trailing slash are insignificant. */
function normalizeSourceUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || key === 'fbclid' || key === 'gclid') url.searchParams.delete(key);
  }
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

function isEntry(e: unknown): e is HistoryEntry {
  if (typeof e !== 'object' || e === null) return false;
  const r = e as Record<string, unknown>;
  return typeof r.sourceUrl === 'string' && typeof r.manyfoldUrl === 'string' && typeof r.at === 'number';
}

/** Stored entries; unreadable storage is an error (corrupted data is not: it reads as empty). */
async function readHistory(): Promise<HistoryEntry[]> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  return Array.isArray(stored) ? stored.filter(isEntry) : [];
}

async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    return await readHistory();
  } catch {
    return [];
  }
}

/** Tail of the write queue: writes run one at a time so overlapping sends cannot lose entries. */
let writes: Promise<unknown> = Promise.resolve();

/**
 * Appends an entry. Writes are serialised (read-modify-write is not atomic in `chrome.storage`). If the history
 * cannot be read, this rejects and writes nothing, so a failed read never replaces the stored list.
 */
export function recordSend(entry: HistoryEntry): Promise<void> {
  const run = writes.then(async () => {
    const list = await readHistory();
    list.push({ sourceUrl: entry.sourceUrl, manyfoldUrl: entry.manyfoldUrl, at: entry.at });
    await chrome.storage.local.set({ [STORAGE_KEY]: list.slice(-MAX_ENTRIES) });
  });
  writes = run.catch(() => undefined);
  return run;
}

export async function findPriorSend(sourceUrl: string): Promise<HistoryEntry | undefined> {
  const target = normalizeSourceUrl(sourceUrl);
  const list = await loadHistory();
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e && normalizeSourceUrl(e.sourceUrl) === target) return e;
  }
  return undefined;
}
