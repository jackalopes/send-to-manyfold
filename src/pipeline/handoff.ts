/**
 * Manyfold's own importer for a source URL (`ImportsController#new`, read from Manyfold 0.153.0's source). It shows an
 * Import button when the admin has set that site's API key, and the site as unsupported otherwise.
 */
export function handoffUrl(baseUrl: string, sourceUrl: string): string {
  return `${baseUrl}/imports/new?url=${encodeURIComponent(sourceUrl)}`;
}
