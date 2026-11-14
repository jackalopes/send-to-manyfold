/**
 * A plain zip writer for the rebuild of an incomplete archive: every file stored (method 0), UTF-8 names, CRC-32 and
 * sizes in both headers (no data descriptors). It never writes ZIP64: anything that would need it throws instead of
 * producing a corrupt zip (unreachable under Manyfold's 1 GiB upload limit).
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const MAX_FIELD = 0xfffffffe;
const MAX_ENTRIES = 0xfffe;
/** General purpose flag bit 11: names are UTF-8. */
const UTF8_FLAG = 0x0800;
/** Version needed to extract: 2.0. */
const VERSION = 20;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date (local time, 2-second steps, years 1980-2107). */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function storedZip(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  if (entries.length > MAX_ENTRIES) throw new Error('Too many files for a plain zip (ZIP64 is not written).');
  const enc = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let cdSize = 0;
  let offset = 0;
  for (const { name, blob } of entries) {
    const n = enc.encode(name);
    if (n.length > 0xffff || blob.size > MAX_FIELD || offset > MAX_FIELD) throw new Error('A file is too large for a plain zip (ZIP64 is not written).');
    const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_SIG, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8_FLAG, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, blob.size, true);
    local.setUint32(22, blob.size, true);
    local.setUint16(26, n.length, true);
    parts.push(new Uint8Array(local.buffer), n, blob);

    const cen = new DataView(new ArrayBuffer(46 + n.length));
    cen.setUint32(0, CENTRAL_SIG, true);
    cen.setUint16(4, VERSION, true);
    cen.setUint16(6, VERSION, true);
    cen.setUint16(8, UTF8_FLAG, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, blob.size, true);
    cen.setUint32(24, blob.size, true);
    cen.setUint16(28, n.length, true);
    cen.setUint32(42, offset, true);
    new Uint8Array(cen.buffer).set(n, 46);
    central.push(new Uint8Array(cen.buffer));
    cdSize += cen.byteLength;
    offset += 30 + n.length + blob.size;
  }
  if (offset > MAX_FIELD || cdSize > MAX_FIELD || offset + cdSize > MAX_FIELD) throw new Error('The zip is too large for a plain zip (ZIP64 is not written).');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, EOCD_SIG, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
