import { DownloadFailed, DownloadNotFound } from '../adapters/errors';
import { MESSAGES, PipelineError } from '../pipeline/errors';
import { isHttps, MAX_UPLOAD_BYTES, tooLargeMessage, uploadLimit } from '../pipeline/files';

/**
 * The offscreen document's `SendDeps.fetchFile`: downloads an `https:` link into memory (a Blob; nothing touches the
 * disk), following redirects. Credentials are omitted: every link the adapters hand over works without cookies
 * (GitHub raw/release links and their CDN redirects are public; Printables and MakerWorld return signed CDN links;
 * cover images are public), and the user's site session stays in the page, where the links are resolved.
 * The size limit (1 GiB unless the caller passes the server's smaller one) is checked against Content-Length and again while reading. Cancel aborts fetch and read.
 */
export function createFetchFile(fetchImpl: typeof fetch = (...a) => fetch(...a), maxBytes: number = MAX_UPLOAD_BYTES) {
  return async function fetchFile(url: string, signal?: AbortSignal, limitBytes?: number): Promise<Blob> {
    const cap = limitBytes ?? maxBytes;
    if (!isHttps(url)) throw notHttps();
    signal?.throwIfAborted();
    const res = await fetchImpl(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', ...(signal ? { signal } : {}) });
    if (res.url && !isHttps(res.url)) throw notHttps();
    if (!res.ok) throw new (res.status === 404 ? DownloadNotFound : DownloadFailed)(`Downloading the file failed: the site answered HTTP ${res.status}. Try again.`);
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > cap) throw tooLarge(limitBytes);
    const type = res.headers.get('content-type') ?? '';
    if (!res.body) return new Blob([await res.arrayBuffer()], { type });

    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) throw tooLarge(limitBytes);
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
    } catch (e) {
      void reader.cancel().catch(() => undefined);
      throw e;
    }
    return new Blob(chunks, { type });
  };
}

const notHttps = () => new PipelineError('download-not-https', MESSAGES['download-not-https']);
/** The caller's limit (the pipeline's) words the message; without one it is the default text. */
const tooLarge = (limitBytes?: number) =>
  new PipelineError('too-large', limitBytes === undefined ? MESSAGES['too-large'] : tooLargeMessage('The file', uploadLimit(limitBytes)));
