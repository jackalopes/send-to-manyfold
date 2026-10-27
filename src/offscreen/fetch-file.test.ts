import { describe, expect, it, vi } from 'vitest';
import { toSendError } from '../pipeline/errors';
import { createFetchFile } from './fetch-file';

const MiB = 1024 * 1024;

function streamOf(chunks: Uint8Array[], onPull?: (i: number) => void): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(ctl) {
      onPull?.(i);
      if (i < chunks.length) ctl.enqueue(chunks[i++]!);
      else ctl.close();
    },
  }, { highWaterMark: 0 });
}

function response(body: BodyInit | null, init: ResponseInit & { url?: string } = {}): Response {
  const res = new Response(body, init);
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return toSendError(e, 'downloading').code;
  }
  return 'resolved';
};

describe('fetchFile', () => {
  it('streams the body into a Blob with the content type, without credentials, following redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), { headers: { 'content-type': 'model/stl' }, url: 'https://cdn.example.com/a.stl' }),
    );
    const blob = await createFetchFile(fetchImpl)('https://github.com/o/r/raw/main/a.stl');
    expect(blob.type).toBe('model/stl');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'follow' });
  });

  it('refuses a non-https URL without fetching', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await code(createFetchFile(fetchImpl)('http://cdn.example.com/a.stl'))).toBe('download-not-https');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a redirect that ends on http', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response('x', { url: 'http://cdn.example.com/a.stl' }));
    expect(await code(createFetchFile(fetchImpl)('https://cdn.example.com/a.stl'))).toBe('download-not-https');
  });

  it('a non-2xx answer is a download failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response('denied', { status: 403 }));
    expect(await code(createFetchFile(fetchImpl)('https://cdn.example.com/a.stl'))).toBe('download-failed');
  });

  it('a Content-Length over 1 GiB is refused before reading', async () => {
    const pulled = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => response(streamOf([new Uint8Array(1)], pulled), { headers: { 'content-length': String(1024 * MiB + 1) } }));
    expect(await code(createFetchFile(fetchImpl)('https://cdn.example.com/a.stl'))).toBe('too-large');
    expect(pulled).not.toHaveBeenCalled();
  });

  it('a body that grows past the cap while reading is refused and the stream cancelled', async () => {
    const chunk = new Uint8Array(4);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: (ctl) => ctl.enqueue(chunk),
      cancel: () => {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => response(body));
    expect(await code(createFetchFile(fetchImpl, 10)('https://cdn.example.com/a.stl'))).toBe('too-large');
    expect(cancelled).toBe(true);
  });

  it('a cancel aborts the fetch and the read', async () => {
    const ctl = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_u, init) => {
      expect(init?.signal).toBe(ctl.signal);
      return response(streamOf([new Uint8Array(1), new Uint8Array(1), new Uint8Array(1)], (i) => i === 1 && ctl.abort()));
    });
    expect(await code(createFetchFile(fetchImpl)('https://cdn.example.com/a.stl', ctl.signal))).toBe('cancelled');
  });
});
