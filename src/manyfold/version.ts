export const MIN_VERSION = '0.147.0';

/** Strips a leading "v"; returns null unless the string is dotted numeric (e.g. "0.153.0"). */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(v.trim());
  return m?.[1] ? m[1].split('.').map(Number) : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}
