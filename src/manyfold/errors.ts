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
  | 'metadata-failed'
  | 'unreachable';

/** Fixed texts for the HTTP statuses every Manyfold call maps the same way. */
export const UNAUTHORIZED_TEXT = 'Manyfold rejected the API token — it may have been revoked, expired or mistyped. Paste a new token in the extension\'s Settings.';
export const FORBIDDEN_TEXT = 'The API token lacks permission for this (it needs the read, write and upload scopes).';
export const UNREACHABLE_TEXT = 'Could not reach the Manyfold server. Check that it is running and try again.';
export const RATE_LIMITED_TEXT = 'Manyfold is limiting requests. Wait a minute and try again.';

/** User-facing error. Messages are fixed strings plus file names/sizes/status codes; never the token. */
export class ManyfoldError extends Error {
  constructor(
    readonly code: ManyfoldErrorCode,
    message: string,
    /** For `upload-failed` and `unreachable` during an upload: pass back as `resumeUrl` to continue the same Tus upload. */
    readonly uploadUrl?: string,
  ) {
    super(message);
    this.name = 'ManyfoldError';
  }
}
