/**
 * MakerWorld data tables and the shape of the page state the adapter reads.
 *
 * License labels: the site's own table (module 78412 of `https://makerworld.com/_next/static/chunks/pages/_app-d75eb2f77ea8ee8c.js`,
 * fetched 2026-10-26), `value` (what `design.license` holds) -> `label` (what the page shows). MakerWorld's own
 * licenses use the same string for both, so any value not listed here is shown as is.
 */
export const LICENSE_LABELS: Readonly<Record<string, string>> = {
  CC0: 'Creative Commons-Public Domain',
  BY: 'Creative Commons-Attribution',
  'BY-SA': 'Creative Commons-Attribution-Share Alike',
  'BY-ND': 'Creative Commons-Attribution-NoDerivatives',
  'BY-NC': 'Creative Commons-Attribution-Noncommercial',
  'BY-NC-SA': 'Creative Commons-Attribution-Noncommercial-Share Alike',
  'BY-NC-ND': 'Creative Commons-Attribution-Noncommercial-NoDerivatives',
};

/**
 * Headers the site's API client adds to every design-service call (module 16951 of the same `_app` bundle:
 * `{"X-BBL-Client-Type":"web","X-BBL-Client-Version":"00.00.00.01","X-BBL-App-Source":"makerworld","X-BBL-Client-Name":"MakerWorld"}`),
 * plus axios' default `Accept`. Seen exactly so on the page's own `/api/v1/comment-service/...` request.
 */
export const CLIENT_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/json, text/plain, */*',
  'X-BBL-Client-Type': 'web',
  'X-BBL-Client-Version': '00.00.00.01',
  'X-BBL-App-Source': 'makerworld',
  'X-BBL-Client-Name': 'MakerWorld',
};

/** The parts of `__NEXT_DATA__.props.pageProps.design` the adapter reads (everything is optional: page data). */
export interface MwDesign {
  id?: unknown;
  title?: unknown;
  slug?: unknown;
  summary?: unknown;
  coverUrl?: unknown;
  license?: unknown;
  tags?: unknown;
  designCreator?: { name?: unknown; handle?: unknown } | null;
  designExtension?: { model_files?: MwModelFile[] | null } | null;
  instances?: MwInstance[] | null;
  isPointRedeemable?: unknown;
  isAlreadyRedeemed?: unknown;
  paidSetting?: { crowdfunding?: unknown } | null;
  hasBacked?: unknown;
}

export interface MwModelFile {
  modelName?: unknown;
  modelSize?: unknown;
  modelType?: unknown;
  modelFileName?: unknown;
  unikey?: unknown;
  isDir?: unknown;
  dirName?: unknown;
  protected?: unknown;
  children?: MwModelFile[] | null;
}

export interface MwInstance {
  id?: unknown;
  title?: unknown;
  extention?: { modelInfo?: { f3mf?: { size?: unknown } | null; compatibility?: { devModelName?: unknown } | null } | null } | null;
}
