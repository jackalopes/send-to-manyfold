import { downloadErrorCode, type DownloadErrorCode } from '../adapters/errors';
import { ManyfoldError, UNAUTHORIZED_TEXT, type ManyfoldErrorCode } from '../manyfold/errors';
import type { SendStage } from './types';

export type SendErrorCode =
  | 'cancelled'
  | 'login-required'
  | 'access-denied'
  | 'blocked'
  | 'download-failed'
  | 'download-not-https'
  | 'too-large'
  | 'manyfold-unreachable'
  | 'manyfold-unauthorized'
  | 'manyfold-forbidden'
  | 'manyfold-too-old'
  | 'no-library'
  | 'rate-limited'
  | 'upload-failed'
  | 'create-failed'
  | 'create-ambiguous'
  | 'extraction-timeout'
  | 'model-not-found'
  | 'metadata-failed'
  | 'no-files'
  | 'retry-unavailable'
  | 'send-in-progress'
  | 'source-tab-closed'
  | 'source-tab-changed'
  | 'not-configured'
  | 'no-permission'
  | 'offscreen-blocked'
  | 'unknown';

/**
 * A send failure as plain JSON: it crosses chrome.runtime messaging, where `Error.message` and `instanceof` are
 * lost. `message` is user-facing and never contains the token.
 */
export interface SendError {
  code: SendErrorCode;
  message: string;
  stage: SendStage;
}

/** A failure the pipeline itself detects, with its final code and message. */
export class PipelineError extends Error {
  override readonly name = 'PipelineError';
  constructor(
    readonly code: SendErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const MESSAGES: Record<SendErrorCode, string> = {
  cancelled: 'Cancelled.',
  'login-required': 'Sign in to the site to download this model, then try again.',
  'access-denied': 'The site does not allow downloading this file (it may be paid or members-only).',
  blocked: 'The site answered with a bot check instead of the file. Reload the page and try again.',
  'download-failed': 'Downloading the file from the site failed. Try again.',
  'download-not-https': 'The site gave a download link that is not https, so it was not used.',
  'too-large': 'The file is larger than Manyfold accepts (1 GiB).',
  'manyfold-unreachable': 'Could not reach the Manyfold server. Check that it is running and try again.',
  'manyfold-unauthorized': UNAUTHORIZED_TEXT,
  'manyfold-forbidden': 'The API token lacks permission for this (it needs the read, write and upload scopes).',
  'manyfold-too-old': 'This Manyfold version is too old. Upgrade Manyfold to 0.147.0 or newer.',
  'no-library': 'Manyfold has no library yet. Create a library in Manyfold first, then try again.',
  'rate-limited': 'Manyfold is limiting how fast models can be created. Wait two minutes, then retry.',
  'upload-failed': 'Uploading to Manyfold failed. Retry to resume.',
  'create-failed': 'Manyfold could not create the model.',
  'create-ambiguous':
    'Manyfold did not confirm the new model, so it may already exist. Check your Manyfold library before sending again.',
  'extraction-timeout': 'Manyfold has not finished unpacking the archive yet. Check the model in Manyfold, or retry to keep waiting.',
  'model-not-found': 'The model was not found in Manyfold (it may have been deleted).',
  'metadata-failed': 'Some details could not be saved in Manyfold.',
  'no-files': 'No files are selected to send.',
  'retry-unavailable': 'This send can no longer be retried. Start it again from the page.',
  'send-in-progress': 'This send is still running.',
  'source-tab-closed': 'The tab with the model page was closed, so the download links could not be fetched. Open the model page again, then retry.',
  'source-tab-changed': 'The tab with the model page has moved to another page (or needs a reload), so the download links could not be fetched. Open the model page again, then retry.',
  'not-configured': 'Set your Manyfold URL and API token in the extension settings first.',
  'offscreen-blocked': 'The extension could not start its transfer page correctly. Reload the extension (chrome://extensions) and try again.',
  'no-permission': 'The extension has no permission to reach your Manyfold server. Save the settings again to grant it.',
  unknown: 'Something went wrong while sending.',
};

const FROM_DOWNLOAD: Record<DownloadErrorCode, SendErrorCode> = {
  DOWNLOAD_ERROR: 'download-failed',
  DOWNLOAD_FAILED: 'download-failed',
  DOWNLOAD_LOGIN_REQUIRED: 'login-required',
  DOWNLOAD_ACCESS_DENIED: 'access-denied',
  DOWNLOAD_BLOCKED: 'blocked',
};

const FROM_MANYFOLD: Record<ManyfoldErrorCode, SendErrorCode> = {
  'too-large': 'too-large',
  'too-old': 'manyfold-too-old',
  'no-library': 'no-library',
  unauthorized: 'manyfold-unauthorized',
  forbidden: 'manyfold-forbidden',
  'rate-limited': 'rate-limited',
  'not-found': 'model-not-found',
  'upload-failed': 'upload-failed',
  'create-failed': 'create-failed',
  'extraction-timeout': 'extraction-timeout',
  'metadata-failed': 'metadata-failed',
};

export function isAbort(e: unknown): boolean {
  return errorName(e) === 'AbortError';
}

/**
 * Maps anything thrown during a send to a stable code. Messages of our own error classes are kept (they hold
 * fixed text plus file names); a plain `{ code }` object (an error after messaging) gets the fixed message for
 * its code; any other error's text is dropped, since it could contain anything.
 */
export function toSendError(e: unknown, stage: SendStage): SendError {
  if (isAbort(e)) return { code: 'cancelled', message: MESSAGES.cancelled, stage };
  if (e instanceof PipelineError) return { code: e.code, message: e.message, stage };
  if (e instanceof ManyfoldError) return { code: FROM_MANYFOLD[e.code], message: e.message, stage };

  const dl = downloadErrorCode(e);
  if (dl) {
    const code = FROM_DOWNLOAD[dl];
    const own = e instanceof Error && e.message ? e.message : undefined;
    return { code, message: own ?? MESSAGES[code], stage };
  }
  const plain = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  if (typeof plain === 'string' && Object.hasOwn(FROM_MANYFOLD, plain)) {
    const code = FROM_MANYFOLD[plain as ManyfoldErrorCode];
    return { code, message: MESSAGES[code], stage };
  }
  if (typeof plain === 'string' && Object.hasOwn(MESSAGES, plain)) {
    const code = plain as SendErrorCode;
    return { code, message: MESSAGES[code], stage };
  }

  const name = errorName(e);
  if (name === 'TypeError' || name === 'TimeoutError') {
    const code = stage === 'downloading' ? 'download-failed' : 'manyfold-unreachable';
    return { code, message: MESSAGES[code], stage };
  }
  return { code: 'unknown', message: MESSAGES.unknown, stage };
}

function errorName(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const name = (e as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}
