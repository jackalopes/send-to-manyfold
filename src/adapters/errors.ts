/**
 * Why a download link could not be resolved, as distinct types so the popup can show the right message.
 * `name` and `code` are string literals (not derived from class names, which minification mangles) so they
 * survive production builds and chrome.runtime messaging, where `instanceof` is lost; read them back with
 * `downloadErrorCode`.
 */
export const DOWNLOAD_ERROR_CODES = [
  'DOWNLOAD_ERROR',
  'DOWNLOAD_LOGIN_REQUIRED',
  'DOWNLOAD_ACCESS_DENIED',
  'DOWNLOAD_BLOCKED',
  'DOWNLOAD_FAILED',
] as const;
export type DownloadErrorCode = (typeof DOWNLOAD_ERROR_CODES)[number];

export class DownloadError extends Error {
  override readonly name: string = 'DownloadError';
  readonly code: DownloadErrorCode = 'DOWNLOAD_ERROR';
}

/** The site wants the user signed in (HTTP 401, or a sign-in message from the API). */
export class DownloadLoginRequired extends DownloadError {
  override readonly name = 'DownloadLoginRequired';
  override readonly code = 'DOWNLOAD_LOGIN_REQUIRED';
  constructor(fileName: string) {
    super(`Sign in to the site to download ${fileName}.`);
  }
}

/** Signed in or not, this user may not download the file (paid, club or members-only model). */
export class DownloadAccessDenied extends DownloadError {
  override readonly name = 'DownloadAccessDenied';
  override readonly code = 'DOWNLOAD_ACCESS_DENIED';
  constructor(fileName: string, detail?: string) {
    super(`The site does not allow downloading ${fileName}${detail ? `: ${detail}` : '.'}`);
  }
}

/** A bot check or block page (e.g. Cloudflare) answered instead of the API. Opening the site again usually clears it. */
export class DownloadBlocked extends DownloadError {
  override readonly name = 'DownloadBlocked';
  override readonly code = 'DOWNLOAD_BLOCKED';
  constructor(fileName: string) {
    super(`The site answered with a bot check instead of a download link for ${fileName}. Reload the page and try again.`);
  }
}

/** Any other failure (server error, rate limit, missing reference, unexpected answer). */
export class DownloadFailed extends DownloadError {
  override readonly name = 'DownloadFailed';
  override readonly code = 'DOWNLOAD_FAILED';
}

/** The download error code of an error instance or of a plain `{ code }` object received over messaging. */
export function downloadErrorCode(e: unknown): DownloadErrorCode | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const code = (e as { code?: unknown }).code;
  return (DOWNLOAD_ERROR_CODES as readonly unknown[]).includes(code) ? (code as DownloadErrorCode) : undefined;
}
