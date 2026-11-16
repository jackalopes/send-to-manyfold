import { formatBytes } from '../format';
import { classifyFile, isArchiveExtension } from '../types';

/**
 * Manyfold's Tus server accepts at most 1 GiB per file by default (`Tus-Max-Size: 1073741824` on 0.153.0). This is
 * also the most the extension itself sends, even to a server that allows more: a file is held in memory (twice
 * over while a Blob is built from the read chunks), and the zip of a Voron bundle is plain ZIP (no ZIP64).
 */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Where the limit in force comes from: the server's `Tus-Max-Size`, this extension's own cap, or the default while the server's is unknown. */
export interface UploadLimit {
  bytes: number;
  source: 'server' | 'extension' | 'default';
}

/** The size limit for one file, given the server's `Tus-Max-Size` when it is known. Never above 1 GiB. */
export function uploadLimit(serverMax?: number): UploadLimit {
  if (serverMax === undefined) return { bytes: MAX_UPLOAD_BYTES, source: 'default' };
  return serverMax < MAX_UPLOAD_BYTES ? { bytes: serverMax, source: 'server' } : { bytes: MAX_UPLOAD_BYTES, source: 'extension' };
}

/** The popup's reason for a disabled file (it is already unticked, so the next step is about the file itself). */
export function tooLargeReason(limit: UploadLimit): string {
  const size = formatBytes(limit.bytes);
  if (limit.source === 'server') return `Larger than ${size}, which this Manyfold server does not accept. Leave it out, or raise the upload limit on the server.`;
  if (limit.source === 'extension') return `Larger than ${size}, the most this extension can send. Leave it out, or add it in Manyfold directly.`;
  return `Larger than ${size}, which Manyfold does not accept. Leave it out.`;
}

/** What happened and what to do, for something (`subject`: a quoted name or "The file") that is over the limit. */
export function tooLargeMessage(subject: string, limit: UploadLimit): string {
  const size = formatBytes(limit.bytes);
  if (limit.source === 'server') return `${subject} is larger than this Manyfold server accepts (${size}). Leave it out and send the rest, or raise the upload limit on the server.`;
  if (limit.source === 'extension') return `${subject} is larger than ${size}, the most this extension can send. Leave it out and send the rest, or add it in Manyfold directly.`;
  return `${subject} is larger than Manyfold accepts (${size}). Leave it out and send the rest.`;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/** Last path segment without control characters, trimmed. Empty when nothing usable is left. */
export function sanitizeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '');
  const last = cleaned.split(/[/\\]/).pop() ?? '';
  const name = last.trim();
  return name === '.' || name === '..' ? '' : name;
}

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
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
  return isArchiveExtension(extensionOf(name)) || classifyFile(name) === 'archive';
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
