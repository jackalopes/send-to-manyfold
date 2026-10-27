import { DownloadError, downloadErrorCode, DownloadFailed, type DownloadErrorCode } from '../adapters/errors';
import { MESSAGES, PipelineError, type SendErrorCode } from './errors';
import type { WireError } from './messages';

/**
 * Download errors cross two messaging hops (content script -> background -> offscreen document), where
 * `instanceof` and `Error.message` are lost. These turn them into plain `{code, message}` and back into errors that
 * `toSendError` maps exactly as if the adapter had thrown them in the same context.
 */

/** Content script side: a `DownloadError` keeps its code and (fixed, file-name-only) message; anything else is a plain download failure. */
export function toWireError(e: unknown): WireError {
  const code = downloadErrorCode(e);
  if (code && e instanceof DownloadError) return { code, message: e.message };
  if (code) return { code, message: MESSAGES['download-failed'] };
  return { code: 'DOWNLOAD_FAILED', message: MESSAGES['download-failed'] };
}

class ForwardedDownloadError extends DownloadError {
  override readonly name = 'ForwardedDownloadError';
  constructor(
    override readonly code: DownloadErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Offscreen side: back to an error `toSendError` understands. Unknown codes never pass their text on. */
export function fromWireError(w: WireError): Error {
  const download = downloadErrorCode(w);
  if (download) return new ForwardedDownloadError(download, w.message);
  if (Object.hasOwn(MESSAGES, w.code)) return new PipelineError(w.code as SendErrorCode, w.message);
  return new DownloadFailed(MESSAGES['download-failed']);
}
