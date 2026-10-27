/**
 * The extension's message protocol: every message is plain JSON (chrome messaging drops classes, `Error.message`
 * and Blobs) and is validated on arrival, so an unknown or malformed shape is rejected, never guessed at.
 *
 * Routes:
 * - extension pages (popup, options) -> background: `send`, `cancel`, `retry`, `discard`, `status`
 * - background -> offscreen document: the same verbs (`start` instead of `send`), which run the pipeline
 * - offscreen document -> background: `getConnection` (base URL and token, in the direct reply only),
 *   `resolveDownload` (forwarded to the source tab's content script), `recordSend` (sent history)
 * - background or popup -> content script (`chrome.tabs.sendMessage`): `extract`, `resolveDownload`
 * - offscreen document -> everyone (`chrome.runtime.sendMessage`): `SendEvent`s (progress, result, expired, discarded)
 *
 * Requests carry `to` so each `runtime.onMessage` listener (several extension contexts hear every broadcast)
 * picks only its own. A send is correlated by its `sendId` (also its retry token). The token never appears in
 * any message except the `getConnection` reply, which goes to the offscreen document alone.
 */
import type { ResolvedDownload } from '../adapters/index';
import type { HistoryEntry } from '../history';
import type { SiteId, SourceFile, SourceModel } from '../types';
import type { SendError } from './errors';
import { hasShape, isBool, isId, isInt, isNumber, isRecord, isString, isStringArray, oneOf, optional, type Rec } from './guards';
import type { SendProgress, SendRequest, SendResult, SendStage } from './types';

export type PageRequest =
  | { to: 'background'; type: 'send'; request: SendRequest; tabId: number }
  | { to: 'background'; type: 'cancel'; sendId: string }
  /** `tabId`: the tab to resolve download links in from now on (the source tab may have been closed). */
  | { to: 'background'; type: 'retry'; sendId: string; forceCreate?: boolean; tabId?: number }
  | { to: 'background'; type: 'discard'; sendId: string }
  | { to: 'background'; type: 'status' };

export type OffscreenToBackground =
  | { to: 'background'; type: 'getConnection' }
  | { to: 'background'; type: 'resolveDownload'; sendId: string; tabId: number; site: SiteId; file: SourceFile }
  | { to: 'background'; type: 'recordSend'; entry: HistoryEntry };

export type BackgroundRequest = PageRequest | OffscreenToBackground;

export type OffscreenRequest =
  | { to: 'offscreen'; type: 'start'; sendId: string; request: SendRequest; tabId: number }
  | { to: 'offscreen'; type: 'retry'; sendId: string; forceCreate?: boolean; tabId?: number }
  | { to: 'offscreen'; type: 'cancel'; sendId: string }
  | { to: 'offscreen'; type: 'discard'; sendId: string }
  | { to: 'offscreen'; type: 'status' };

/** Content script -> background: whether the page is a supported model page (toolbar badge), and the injected button's click. */
export type TabNotice = { to: 'background'; type: 'pageState'; supported: boolean } | { to: 'background'; type: 'openPopup' };

export type ContentRequest = { to: 'content'; type: 'extract' } | { to: 'content'; type: 'resolveDownload'; site: SiteId; file: SourceFile };

/** Broadcast by the offscreen document to every extension page (and the background). */
export type SendEvent =
  | { event: 'progress'; sendId: string; progress: SendProgress }
  | { event: 'result'; sendId: string; result: SendResult }
  /** A failed send's retained downloads were dropped after the idle TTL; it can no longer be retried. */
  | { event: 'expired'; sendId: string }
  /** A retained send was discarded on request (its created models are recorded in the history first). */
  | { event: 'discarded'; sendId: string };

/** An error from a context that has no send stage (content script): a download error code or a `SendErrorCode`. */
export interface WireError {
  code: string;
  message: string;
}

/** What `status` reports per send the offscreen document still holds. */
export interface SendStatus {
  sendId: string;
  running: boolean;
  /** The latest progress of a running send. */
  progress?: SendProgress;
  /** The failed result a retained send can be retried from. */
  result?: SendResult;
  /** When a retained (failed) send's downloads are dropped, in ms since the epoch. */
  expiresAt?: number;
}

export type Fail = { ok: false; error: SendError };
export type AckReply = { ok: true } | Fail;
export type SendReply = { ok: true; sendId: string } | Fail;
export type StatusReply = { ok: true; sends: SendStatus[] } | Fail;
export type ConnectionReply = { ok: true; baseUrl: string; token: string } | Fail;
export type ResolveReply = { ok: true; download: string | ResolvedDownload } | { ok: false; error: WireError };
export type ExtractReply = { ok: true; model: SourceModel } | { ok: false; error: WireError };

const SITES = ['printables', 'thingiverse', 'makerworld', 'github'] as const satisfies readonly SiteId[];
const STAGES = ['downloading', 'uploading', 'creating', 'extracting', 'metadata', 'done'] as const satisfies readonly SendStage[];
const isSite = oneOf(SITES);
const isStage = oneOf(STAGES);
const isKind = oneOf(['model', 'image', 'archive', 'other'] as const);
const optString = optional(isString);
const optNumber = optional(isNumber);

const isStringRecord = (v: unknown): boolean => isRecord(v) && Object.values(v).every(isString);

export function isSourceFile(v: unknown): v is SourceFile {
  return isRecord(v) && hasShape(v, { name: isString, kind: isKind, url: optString, size: optNumber, lfs: optional(isBool), ref: (r) => r === undefined || isStringRecord(r) });
}

export function isSourceModel(v: unknown): v is SourceModel {
  if (!isRecord(v)) return false;
  const creator = (c: unknown) => c === undefined || (isRecord(c) && hasShape(c, { name: isString, url: optString }));
  return (
    hasShape(v, {
      site: (s) => isSite(s) || s === 'other',
      sourceUrl: isString,
      title: isString,
      description: optString,
      licenseText: optString,
      coverImageUrl: optString,
      tags: isStringArray,
      creator,
      loginRequired: optional(isBool),
      delivery: optional(oneOf(['download', 'manyfold-import'] as const)),
    }) &&
    Array.isArray(v.files) &&
    v.files.every(isSourceFile)
  );
}

export function isSendRequest(v: unknown): v is SendRequest {
  return (
    isRecord(v) &&
    hasShape(v, {
      source: isSourceModel,
      selectedFiles: (f) => Array.isArray(f) && f.every(isSourceFile),
      title: isString,
      description: optString,
      caption: optString,
      licenseId: optString,
      collectionIds: isStringArray,
      sensitive: isBool,
      includeCover: isBool,
      omitSourceLink: optional(isBool),
    })
  );
}

const isProgress = (v: unknown): v is SendProgress =>
  isRecord(v) &&
  hasShape(v, { stage: isStage, label: isString, fileIndex: optNumber, fileCount: optNumber, sent: optNumber, total: optNumber, modelIndex: optNumber, modelCount: optNumber });

const isWireError = (v: unknown): v is WireError => isRecord(v) && hasShape(v, { code: isString, message: isString });

/** Results come from our own pipeline; this checks the discriminant and the fields a page branches on. */
const isResult = (v: unknown): v is SendResult => {
  if (!isRecord(v)) return false;
  switch (v.status) {
    case 'done':
      return isString(v.modelUrl) && Array.isArray(v.models);
    case 'failed':
      return isStage(v.stage) && isWireError(v.error) && Array.isArray(v.models);
    case 'handoff':
      return isString(v.url);
    case 'unsupported':
      return true;
    default:
      return false;
  }
};

const isHistoryEntry = (v: unknown): v is HistoryEntry => isRecord(v) && hasShape(v, { sourceUrl: isString, manyfoldUrl: isString, at: isNumber });

type Shapes = Record<string, Record<string, (v: unknown) => boolean>>;

const VERBS: Shapes = {
  cancel: { sendId: isId },
  retry: { sendId: isId, forceCreate: optional(isBool), tabId: optional(isInt) },
  discard: { sendId: isId },
  status: {},
};

const BACKGROUND: Shapes = {
  ...VERBS,
  send: { request: isSendRequest, tabId: isInt },
  getConnection: {},
  resolveDownload: { sendId: isId, tabId: isInt, site: isSite, file: isSourceFile },
  recordSend: { entry: isHistoryEntry },
};

const OFFSCREEN: Shapes = { ...VERBS, start: { sendId: isId, request: isSendRequest, tabId: isInt } };

const TAB: Shapes = { pageState: { supported: isBool }, openPopup: {} };

const CONTENT: Shapes = { extract: {}, resolveDownload: { site: isSite, file: isSourceFile } };

function parseRequest<T>(m: unknown, to: string, shapes: Shapes): T | undefined {
  if (!isRecord(m) || m.to !== to || !isString(m.type) || !Object.hasOwn(shapes, m.type)) return undefined;
  return hasShape(m, shapes[m.type]!) ? (m as T) : undefined;
}

export const parseBackgroundRequest = (m: unknown) => parseRequest<BackgroundRequest>(m, 'background', BACKGROUND);
export const parseOffscreenRequest = (m: unknown) => parseRequest<OffscreenRequest>(m, 'offscreen', OFFSCREEN);
export const parseTabNotice = (m: unknown) => parseRequest<TabNotice>(m, 'background', TAB);
export const parseContentRequest = (m: unknown) => parseRequest<ContentRequest>(m, 'content', CONTENT);

export function parseSendEvent(m: unknown): SendEvent | undefined {
  if (!isRecord(m) || !isId(m.sendId)) return undefined;
  const ok =
    (m.event === 'progress' && isProgress(m.progress)) || (m.event === 'result' && isResult(m.result)) || m.event === 'expired' || m.event === 'discarded';
  return ok ? (m as SendEvent) : undefined;
}

const isDownload = (d: unknown): d is string | ResolvedDownload => isString(d) || (isRecord(d) && hasShape(d, { url: isString, name: optString }));

function parseReply<T>(m: unknown, okShape: (r: Rec) => boolean): T | undefined {
  if (!isRecord(m)) return undefined;
  if (m.ok === true) return okShape(m) ? (m as T) : undefined;
  if (m.ok === false) return isWireError(m.error) ? (m as T) : undefined;
  return undefined;
}

export const parseResolveReply = (m: unknown) => parseReply<ResolveReply>(m, (r) => isDownload(r.download));
export const parseExtractReply = (m: unknown) => parseReply<ExtractReply>(m, (r) => isSourceModel(r.model));
