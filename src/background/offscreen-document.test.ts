import { describe, expect, it, vi } from 'vitest';
import { OFFSCREEN_REASONS, OffscreenDocument, type OffscreenApi } from './offscreen-document';

function fakeApi() {
  let open = false;
  const api = {
    createDocument: vi.fn(async () => {
      await Promise.resolve();
      if (open) throw new Error('Only a single offscreen document may be created.');
      open = true;
    }),
    closeDocument: vi.fn(async () => {
      open = false;
    }),
    hasDocument: vi.fn(async () => open),
    get open() {
      return open;
    },
    set open(v: boolean) {
      open = v;
    },
  } satisfies OffscreenApi & { open: boolean };
  return api;
}

describe('OffscreenDocument', () => {
  it('creates the document once with the BLOBS reason and reuses it', async () => {
    const api = fakeApi();
    const doc = new OffscreenDocument(api, 'offscreen.html');
    await Promise.all([doc.use(async () => 1), doc.use(async () => 2), doc.use(async () => 3)]);
    expect(api.createDocument).toHaveBeenCalledTimes(1);
    expect(api.createDocument).toHaveBeenCalledWith({ url: 'offscreen.html', reasons: OFFSCREEN_REASONS, justification: expect.stringMatching(/download/i) });
    expect(OFFSCREEN_REASONS).toEqual(['BLOBS']);
  });

  it('reuses a document that survived a service worker restart (a new instance)', async () => {
    const api = fakeApi();
    api.open = true;
    await new OffscreenDocument(api, 'offscreen.html').use(async () => undefined);
    expect(api.createDocument).not.toHaveBeenCalled();
  });

  it('ifOpen never creates a document', async () => {
    const api = fakeApi();
    const doc = new OffscreenDocument(api, 'offscreen.html');
    expect(await doc.ifOpen(async () => 'ran', 'closed')).toBe('closed');
    api.open = true;
    expect(await doc.ifOpen(async () => 'ran', 'closed')).toBe('ran');
    expect(api.createDocument).not.toHaveBeenCalled();
  });

  it('closes only when idle, and a send queued meanwhile is never cut off', async () => {
    const api = fakeApi();
    const doc = new OffscreenDocument(api, 'offscreen.html');
    await doc.use(async () => undefined);
    expect(await doc.closeIfIdle(async () => false)).toBe(false);
    expect(api.open).toBe(true);

    const order: string[] = [];
    const closing = doc.closeIfIdle(async () => (order.push('idle-check'), true));
    const starting = doc.use(async () => order.push(`start (open: ${api.open})`));
    await Promise.all([closing, starting]);
    expect(order).toEqual(['idle-check', 'start (open: true)']);
    expect(api.createDocument).toHaveBeenCalledTimes(2);
  });

  it('closeIfIdle with no document does nothing', async () => {
    const api = fakeApi();
    expect(await new OffscreenDocument(api, 'offscreen.html').closeIfIdle(async () => true)).toBe(false);
    expect(api.closeDocument).not.toHaveBeenCalled();
  });

  it('a failing operation does not jam the queue', async () => {
    const api = fakeApi();
    const doc = new OffscreenDocument(api, 'offscreen.html');
    await expect(doc.use(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(doc.use(async () => 'next')).resolves.toBe('next');
  });
});
