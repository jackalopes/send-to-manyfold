export type SiteId = 'printables' | 'thingiverse' | 'makerworld' | 'github';

export interface SourceFile {
  name: string;
  /**
   * Direct download URL, when the page itself gives one (e.g. GitHub raw and release asset links). When set it
   * takes precedence: consumers call the adapter's `resolveDownloadUrl` only when `url` is absent.
   */
  url?: string;
  /**
   * Opaque site-specific data that exists only to resolve a download URL later with `resolveDownloadUrl`
   * (e.g. Printables file id and fileType). Never informational flags.
   */
  ref?: Record<string, string>;
  size?: number;
  kind: 'model' | 'image' | 'archive' | 'other';
  /**
   * Informational only: the file is stored with Git LFS (GitHub). Its download link serves the real object, not
   * the LFS pointer text, so it downloads like any other file.
   */
  lfs?: boolean;
}

/**
 * How a model reaches Manyfold. `download` (default): the extension downloads the files and uploads them.
 * `manyfold-import`: the extension cannot download the files (e.g. Thingiverse file ids are out of reach), so the
 * user is handed off to Manyfold's own importer for the source URL instead.
 */
export type Delivery = 'download' | 'manyfold-import';

export interface SourceModel {
  /** `other`: a page no adapter supports (title and URL only, no files). */
  site: SiteId | 'other';
  sourceUrl: string;
  title: string;
  description?: string;
  creator?: { name: string; url?: string };
  licenseText?: string;
  tags: string[];
  files: SourceFile[];
  coverImageUrl?: string;
  loginRequired?: boolean;
  /** Defaults to `download`. */
  delivery?: Delivery;
}

const MODEL_EXTENSIONS = new Set(['stl', '3mf', 'obj', 'step', 'stp']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

export function classifyFile(name: string): SourceFile['kind'] {
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  if (MODEL_EXTENSIONS.has(ext)) return 'model';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  return 'other';
}
