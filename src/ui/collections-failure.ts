import { ManyfoldError } from '../manyfold/errors';

/**
 * Why the collection list could not be loaded, as text safe to show. A `ManyfoldError` carries fixed text (status
 * texts, "Could not reach the Manyfold server."); anything else gets a fixed line, never the error's own text.
 */
export function collectionsFailureText(e: unknown): string {
  if (!(e instanceof ManyfoldError)) return 'Something unexpected went wrong.';
  // `listCollections` prefixes its errors with what it was doing; the note around this text already says so.
  const text = e.message.replace(/^Could not list collections: /, '').trim();
  return text || 'Something unexpected went wrong.';
}
