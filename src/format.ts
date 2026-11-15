const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** A byte count in IEC binary units (1 KiB = 1024 B): `512 B`, `1 GiB`, `199.2 KiB`. Whole numbers show no decimals. */
export function formatBytes(n: number): string {
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${UNITS[i]}`;
}
