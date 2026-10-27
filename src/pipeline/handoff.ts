/** Manyfold's model search for a source URL: where Manyfold's own importer picks it up (unverified for Thingiverse). */
export function handoffUrl(baseUrl: string, sourceUrl: string): string {
  return `${baseUrl}/models?q=${encodeURIComponent(sourceUrl)}`;
}
