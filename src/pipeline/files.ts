import { classifyFile } from '../types';

/** Manyfold's Tus server accepts at most 1 GiB per file (`Tus-Max-Size: 1073741824` on 0.153.0). */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/** Last path segment without control characters, trimmed. Empty when nothing usable is left. */
export function sanitizeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '');
  const last = cleaned.split(/[/\\]/).pop() ?? '';
  const name = last.trim();
  return name === '.' || name === '..' ? '' : name;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The file name to upload: the site's real name from the download answer when it has one, else the listed name.
 * A resolved name without an extension gets the listed one (Manyfold detects file types by extension).
 */
export function uploadName(listed: string, resolved: string | undefined): string {
  const fallback = sanitizeFileName(listed);
  const real = resolved === undefined ? '' : sanitizeFileName(resolved);
  if (!real) return fallback || 'file';
  const ext = extensionOf(fallback);
  return !extensionOf(real) && ext ? `${real}.${ext}` : real;
}

export function isArchiveName(name: string): boolean {
  return ARCHIVE_EXTENSIONS.has(extensionOf(name)) || classifyFile(name) === 'archive';
}

/** Makes names distinct (ignoring case) by numbering repeats before the extension: `part (2).stl`. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) {
      const dot = name.lastIndexOf('.');
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** A file name for the page cover image, from its URL; always with an image extension. */
export function coverFileName(url: string): string {
  let segment: string;
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    segment = sanitizeFileName(safeDecode(last));
  } catch {
    segment = '';
  }
  const name = segment || 'cover';
  return IMAGE_EXTENSIONS.has(extensionOf(name)) ? name : `${name}.jpg`;
}

/** File name without its extension, for model names ("parts.zip" -> "parts"). */
export function stem(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
