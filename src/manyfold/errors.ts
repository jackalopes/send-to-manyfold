export type ManyfoldErrorCode =
  | 'too-large'
  | 'too-old'
  | 'no-library'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'not-found'
  | 'upload-failed'
  | 'create-failed'
  | 'extraction-timeout'
  | 'metadata-failed';

/** User-facing error. Messages are fixed strings plus file names/sizes/status codes; never the token. */
export class ManyfoldError extends Error {
  constructor(
    readonly code: ManyfoldErrorCode,
    message: string,
    /** For `upload-failed`: pass back as `resumeUrl` to continue the same Tus upload. */
    readonly uploadUrl?: string,
  ) {
    super(message);
    this.name = 'ManyfoldError';
  }
}
