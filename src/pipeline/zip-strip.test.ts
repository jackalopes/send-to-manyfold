import { describe, expect, it } from 'vitest';
import { isReadableZip, stripTopFolder } from './zip-strip';

const enc = new TextEncoder();
const dec = new TextDecoder();

function crc32(data: Uint8Array): number {
  let c = ~0;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

interface TestEntry {
  name: string;
  data?: string;
  flags?: number;
  /** Extra field bytes for both headers. */
  extra?: Uint8Array;
  /** Extra field bytes for the local header only, when it differs from the central one. */
  localExtra?: Uint8Array;
  comment?: string;
}

/** An extra field record: header id, size, data. */
function extraField(id: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, id, true);
  v.setUint16(2, data.length, true);
  out.set(data, 4);
  return out;
}

const concat = (...arrays: Uint8Array[]) => {
  const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
};

/** Builds a stored (method 0) zip with optional flags, extra fields, entry comments and an archive comment. */
function buildZip(entries: TestEntry[], archiveComment = ''): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const n = enc.encode(e.name);
    const d = enc.encode(e.data ?? '');
    const x = e.extra ?? new Uint8Array();
    const lx = e.localExtra ?? x;
    const k = enc.encode(e.comment ?? '');
    const crc = crc32(d);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, e.flags ?? 0x0800, true);
    local.setUint16(10, 0x1234, true); // time
    local.setUint16(12, 0x5678, true); // date
    local.setUint32(14, crc, true);
    local.setUint32(18, d.length, true);
    local.setUint32(22, d.length, true);
    local.setUint16(26, n.length, true);
    local.setUint16(28, lx.length, true);
    parts.push(new Uint8Array(local.buffer), n, lx, d);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 0x031e, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, e.flags ?? 0x0800, true);
    cen.setUint16(12, 0x1234, true);
    cen.setUint16(14, 0x5678, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, d.length, true);
    cen.setUint32(24, d.length, true);
    cen.setUint16(28, n.length, true);
    cen.setUint16(30, x.length, true);
    cen.setUint16(32, k.length, true);
    cen.setUint32(38, e.name.endsWith('/') ? 0x41ed0010 : 0x81a40000, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), n, x, k);
    offset += 30 + n.length + lx.length + d.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const c = enc.encode(archiveComment);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, c.length, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer), c] as BlobPart[]);
}

interface ReadEntry {
  name: string;
  data: string;
  crc: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  externalAttrs: number;
  centralExtra: Uint8Array;
  localExtra: Uint8Array;
  comment: string;
}

/** A strict reader: every offset and size must line up, and each entry's data must match its CRC. */
async function readZip(blob: Blob): Promise<{ entries: ReadEntry[]; comment: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const v = new DataView(bytes.buffer);
  let p = bytes.length - 22;
  while (p >= 0 && !(v.getUint32(p, true) === 0x06054b50 && p + 22 + v.getUint16(p + 20, true) === bytes.length)) p--;
  if (p < 0) throw new Error('no EOCD');
  const count = v.getUint16(p + 10, true);
  expect(v.getUint16(p + 8, true)).toBe(count);
  const cdSize = v.getUint32(p + 12, true);
  const cdOffset = v.getUint32(p + 16, true);
  expect(cdOffset + cdSize).toBe(p);
  const entries: ReadEntry[] = [];
  let c = cdOffset;
  let localEnd = 0;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(c, true)).toBe(0x02014b50);
    const nLen = v.getUint16(c + 28, true);
    const mLen = v.getUint16(c + 30, true);
    const kLen = v.getUint16(c + 32, true);
    const csize = v.getUint32(c + 20, true);
    const crc = v.getUint32(c + 16, true);
    const off = v.getUint32(c + 42, true);
    const name = bytes.slice(c + 46, c + 46 + nLen);
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const lnLen = v.getUint16(off + 26, true);
    const lmLen = v.getUint16(off + 28, true);
    expect(bytes.slice(off + 30, off + 30 + lnLen)).toEqual(name);
    expect(v.getUint32(off + 14, true)).toBe(crc);
    const start = off + 30 + lnLen + lmLen;
    const data = bytes.slice(start, start + csize);
    expect(crc32(data)).toBe(crc);
    localEnd = Math.max(localEnd, start + csize);
    entries.push({
      name: dec.decode(name),
      data: dec.decode(data),
      crc,
      flags: v.getUint16(c + 8, true),
      method: v.getUint16(c + 10, true),
      time: v.getUint16(c + 12, true),
      date: v.getUint16(c + 14, true),
      externalAttrs: v.getUint32(c + 38, true),
      centralExtra: bytes.slice(c + 46 + nLen, c + 46 + nLen + mLen),
      localExtra: bytes.slice(off + 30 + lnLen, off + 30 + lnLen + lmLen),
      comment: dec.decode(bytes.slice(c + 46 + nLen + mLen, c + 46 + nLen + mLen + kLen)),
    });
    c += 46 + nLen + mLen + kLen;
  }
  expect(c).toBe(p);
  expect(localEnd).toBe(cdOffset);
  return { entries, comment: dec.decode(bytes.slice(p + 22)) };
}

const MOD = [
  { name: 'Mod by author/' },
  { name: 'Mod by author/README.md', data: '# Mod\n' },
  { name: 'Mod by author/STLs/' },
  { name: 'Mod by author/STLs/a.stl', data: 'solid a\nendsolid a\n' },
];

describe('stripTopFolder', () => {
  it('removes the shared top folder from every name and drops the folder entry, keeping data and CRCs', async () => {
    const original = buildZip(MOD);
    const before = await readZip(original);
    const out = await stripTopFolder(original);
    expect(out).not.toBe(original);
    const after = await readZip(out);
    expect(after.entries.map((e) => e.name)).toEqual(['README.md', 'STLs/', 'STLs/a.stl']);
    for (const e of after.entries) {
      const was = before.entries.find((b) => b.name === `Mod by author/${e.name}`)!;
      expect({ ...e, name: was.name }).toEqual(was);
    }
  });

  it('a stripped zip is a valid zip: stripping it again (no shared folder left) returns it unchanged', async () => {
    const once = await stripTopFolder(buildZip(MOD));
    expect(await stripTopFolder(once)).toBe(once);
  });

  it('keeps the blob type', async () => {
    const original = new Blob([buildZip(MOD)], { type: 'application/zip' });
    expect((await stripTopFolder(original)).type).toBe('application/zip');
  });

  it.each([
    ['mixed top folders', [{ name: 'a/x.stl', data: 'x' }, { name: 'b/y.stl', data: 'y' }]],
    ['no folder', [{ name: 'x.stl', data: 'x' }, { name: 'y.stl', data: 'y' }]],
    ['a loose file beside the folder', [{ name: 'Mod/x.stl', data: 'x' }, { name: 'y.stl', data: 'y' }]],
    ['a single entry', [{ name: 'Mod/x.stl', data: 'x' }]],
    ['only the folder entry and nothing else', [{ name: 'Mod/' }, { name: 'Mod/' }]],
    ['an empty first segment (absolute path)', [{ name: '/x.stl', data: 'x' }, { name: '/y.stl', data: 'y' }]],
    ['a parent-directory top folder', [{ name: '../x.stl', data: 'x' }, { name: '../y.stl', data: 'y' }]],
    ['names that would become absolute', [{ name: 'Mod//x.stl', data: 'x' }, { name: 'Mod/y.stl', data: 'y' }]],
    ['names that would start with a backslash', [{ name: 'Mod/\\x.stl', data: 'x' }, { name: 'Mod/y.stl', data: 'y' }]],
    ['a .. segment deeper in a name (escapes the root once stripped)', [{ name: 'Top/a/../../evil.txt', data: 'x' }, { name: 'Top/y.stl', data: 'y' }]],
    ['a trailing .. segment', [{ name: 'Top/a/..', data: '' }, { name: 'Top/y.stl', data: 'y' }]],
    ['an encrypted entry (flag bit 0)', [{ name: 'Mod/x.stl', data: 'x', flags: 0x0801 }, { name: 'Mod/y.stl', data: 'y' }]],
  ])('returns the same Blob for %s', async (_what, entries) => {
    const original = buildZip(entries);
    expect(await stripTopFolder(original)).toBe(original);
  });

  it.each([
    ['empty', new Blob([])],
    ['not a zip', new Blob(['hello world, this is not a zip file at all'])],
    ['a truncated zip', buildZip(MOD).slice(0, 60)],
    ['a zip missing its end', buildZip(MOD).slice(0, buildZip(MOD).size - 10)],
    ['a zip missing its start', buildZip(MOD).slice(30)],
  ])('returns %s unchanged without throwing', async (_what, blob) => {
    await expect(stripTopFolder(blob)).resolves.toBe(blob);
  });

  it('returns a zip whose central directory points past its data unchanged', async () => {
    const bytes = new Uint8Array(await buildZip(MOD).arrayBuffer());
    const v = new DataView(bytes.buffer);
    v.setUint32(bytes.length - 22 + 16, v.getUint32(bytes.length - 22 + 16, true) + 1, true);
    const bad = new Blob([bytes]);
    expect(await stripTopFolder(bad)).toBe(bad);
  });

  it('returns a ZIP64 zip unchanged (0xFFFFFFFF marker in an entry)', async () => {
    const bytes = new Uint8Array(await buildZip(MOD).arrayBuffer());
    const v = new DataView(bytes.buffer);
    const cdOffset = v.getUint32(bytes.length - 22 + 16, true);
    v.setUint32(cdOffset + 20, 0xffffffff, true);
    const z64 = new Blob([bytes]);
    expect(await stripTopFolder(z64)).toBe(z64);
  });

  it('returns a zip with a ZIP64 end locator unchanged', async () => {
    const bytes = new Uint8Array(await buildZip(MOD).arrayBuffer());
    const eocd = bytes.length - 22;
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    const v = new DataView(bytes.buffer);
    // Same zip, the locator sitting right before the EOCD (and inside the counted central directory span).
    const withLocator = new Blob([bytes.slice(0, eocd), new Uint8Array(locator.buffer), bytes.slice(eocd)]);
    const fixed = new Uint8Array(await withLocator.arrayBuffer());
    new DataView(fixed.buffer).setUint32(fixed.length - 22 + 12, v.getUint32(eocd + 12, true) + 20, true);
    const z64 = new Blob([fixed]);
    expect(await stripTopFolder(z64)).toBe(z64);
  });

  it('still strips a zip with a trailing archive comment (kept as is)', async () => {
    const comment = 'Downloaded from mods.vorondesign.com PK\x05\x06 not an end record';
    const out = await stripTopFolder(buildZip(MOD, comment));
    const after = await readZip(out);
    expect(after.entries.map((e) => e.name)).toEqual(['README.md', 'STLs/', 'STLs/a.stl']);
    expect(after.comment).toBe(comment);
  });

  it('keeps entry comments', async () => {
    const out = await stripTopFolder(buildZip([{ name: 'M/a.stl', data: 'a', comment: 'first' }, { name: 'M/b.stl', data: 'b' }]));
    expect((await readZip(out)).entries.map((e) => [e.name, e.comment])).toEqual([
      ['a.stl', 'first'],
      ['b.stl', ''],
    ]);
  });

  it('drops the Info-ZIP Unicode Path extra field and keeps the other extra fields in order', async () => {
    const timestamp = extraField(0x5455, new Uint8Array([1, 2, 3, 4, 5]));
    const unicode = extraField(0x7075, concat(new Uint8Array([1, 0, 0, 0, 0]), enc.encode('Mod/a.stl')));
    const unix = extraField(0x7875, new Uint8Array([1, 4, 0xe8, 3, 0, 0, 4, 0xe8, 3, 0, 0]));
    const original = buildZip([
      { name: 'Mod/a.stl', data: 'a', extra: concat(timestamp, unicode, unix) },
      { name: 'Mod/b.stl', data: 'b', extra: unix },
    ]);
    const after = await readZip(await stripTopFolder(original));
    expect(after.entries.map((e) => e.name)).toEqual(['a.stl', 'b.stl']);
    expect(after.entries[0]!.centralExtra).toEqual(concat(timestamp, unix));
    expect(after.entries[0]!.localExtra).toEqual(concat(timestamp, unix));
    expect(after.entries[1]!.centralExtra).toEqual(unix);
  });

  it('returns a zip unchanged when a Unicode Path field holds the only real name (UTF-8 flag clear)', async () => {
    const unicode = extraField(0x7075, concat(new Uint8Array([1, 0, 0, 0, 0]), enc.encode('Modèle/a.stl')));
    const original = buildZip([
      { name: 'Mod\x8ale/a.stl', data: 'a', flags: 0, extra: unicode },
      { name: 'Mod\x8ale/b.stl', data: 'b', flags: 0 },
    ]);
    expect(await stripTopFolder(original)).toBe(original);
  });

  it('returns a zip unchanged when only the local header has a Unicode Path field and the UTF-8 flag is clear', async () => {
    const unicode = extraField(0x7075, concat(new Uint8Array([1, 0, 0, 0, 0]), enc.encode('Mod/a.stl')));
    const original = buildZip([
      { name: 'Mod/a.stl', data: 'a', flags: 0, localExtra: unicode },
      { name: 'Mod/b.stl', data: 'b', flags: 0 },
    ]);
    expect(await stripTopFolder(original)).toBe(original);
  });

  it('strips a CP437 zip (UTF-8 flag clear) that has no Unicode Path field', async () => {
    const after = await readZip(await stripTopFolder(buildZip([
      { name: 'Mod/a.stl', data: 'a', flags: 0 },
      { name: 'Mod/b.stl', data: 'b', flags: 0 },
    ])));
    expect(after.entries.map((e) => [e.name, e.flags])).toEqual([
      ['a.stl', 0],
      ['b.stl', 0],
    ]);
  });

  it('handles local extra fields that differ from the central ones (descriptor flag set), keeping data and CRC', async () => {
    const timestamp = extraField(0x5455, new Uint8Array([3, 1, 2, 3, 4, 5, 6, 7, 8]));
    const short = extraField(0x5455, new Uint8Array([3, 1, 2, 3, 4]));
    const unix = extraField(0x7875, new Uint8Array([1, 4, 0xe8, 3, 0, 0, 4, 0xe8, 3, 0, 0]));
    const original = buildZip([
      { name: 'Mod/a.stl', data: 'solid a\n', flags: 0x0808, localExtra: concat(timestamp, unix), extra: short },
      { name: 'Mod/b.stl', data: 'solid b\n', localExtra: new Uint8Array(), extra: unix },
      { name: 'Mod/c.stl', data: 'solid c\n', localExtra: unix },
    ]);
    const before = await readZip(original);
    const after = await readZip(await stripTopFolder(original));
    expect(after.entries.map((e) => e.name)).toEqual(['a.stl', 'b.stl', 'c.stl']);
    after.entries.forEach((e, i) => expect({ ...e, name: before.entries[i]!.name }).toEqual(before.entries[i]));
    expect(after.entries[0]!.localExtra).toEqual(concat(timestamp, unix));
    expect(after.entries[0]!.centralExtra).toEqual(short);
    expect(after.entries[1]!.localExtra).toEqual(new Uint8Array());
  });

  it('returns a zip with a malformed extra field unchanged', async () => {
    const original = buildZip([
      { name: 'Mod/a.stl', data: 'a', extra: new Uint8Array([0x55, 0x54, 9, 0, 1]) },
      { name: 'Mod/b.stl', data: 'b' },
    ]);
    expect(await stripTopFolder(original)).toBe(original);
  });

  it('keeps data descriptors (flag bit 3) byte for byte', async () => {
    // Stored entries followed by a signed data descriptor; sizes and CRC are also in the central directory.
    const entries = [
      { name: 'M/a.stl', data: 'aaa' },
      { name: 'M/b.stl', data: 'bb' },
    ];
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const e of entries) {
      const n = enc.encode(e.name);
      const d = enc.encode(e.data);
      const crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0808, true);
      h.setUint16(26, n.length, true);
      const dd = new DataView(new ArrayBuffer(16));
      dd.setUint32(0, 0x08074b50, true);
      dd.setUint32(4, crc, true);
      dd.setUint32(8, d.length, true);
      dd.setUint32(12, d.length, true);
      local.push(new Uint8Array(h.buffer), n, d, new Uint8Array(dd.buffer));
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0808, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, d.length, true);
      c.setUint32(24, d.length, true);
      c.setUint16(28, n.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), n);
      offset += 30 + n.length + d.length + 16;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, 2, true);
    end.setUint16(10, 2, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    const out = await stripTopFolder(new Blob([...local, ...central, new Uint8Array(end.buffer)] as BlobPart[]));
    const bytes = new Uint8Array(await out.arrayBuffer());
    const v = new DataView(bytes.buffer);
    // First entry: header (30) + "a.stl" (5) + "aaa" (3), then its descriptor.
    expect(dec.decode(bytes.slice(30, 35))).toBe('a.stl');
    expect(v.getUint32(38, true)).toBe(0x08074b50);
    expect(v.getUint32(42, true)).toBe(crc32(enc.encode('aaa')));
    // Second entry starts right after the first descriptor; the central directory points at it.
    expect(v.getUint32(54, true)).toBe(0x04034b50);
    const cdOffset = v.getUint32(bytes.length - 22 + 16, true);
    const secondCentral = cdOffset + 46 + 5;
    expect(v.getUint32(secondCentral + 42, true)).toBe(54);
    expect(v.getUint16(secondCentral + 8, true)).toBe(0x0808);
  });

  it('handles a real Voron zip shape (spaces, brackets, nested folders)', async () => {
    const top = 'Voron2.4 and Trident Pins Mod by hartk1213/';
    const names = [
      top,
      `${top}README.md`,
      `${top}CAD/`,
      `${top}CAD/Gantry/xy_joint_left.step`,
      `${top}STLs/`,
      `${top}STLs/Z_Idlers/`,
      `${top}STLs/Z_Idlers/[a]_z_tensioner_x4_9mm_pinned.stl`,
      `${top}Images/pins (1).png`,
    ];
    const out = await stripTopFolder(buildZip(names.map((name) => ({ name, data: name.endsWith('/') ? '' : `data of ${name}` }))));
    const after = await readZip(out);
    expect(after.entries.map((e) => e.name)).toEqual([
      'README.md',
      'CAD/',
      'CAD/Gantry/xy_joint_left.step',
      'STLs/',
      'STLs/Z_Idlers/',
      'STLs/Z_Idlers/[a]_z_tensioner_x4_9mm_pinned.stl',
      'Images/pins (1).png',
    ]);
    expect(after.entries[5]!.data).toBe(`data of ${top}STLs/Z_Idlers/[a]_z_tensioner_x4_9mm_pinned.stl`);
  });

  it('works when the central directory lists entries in a different order than the data', async () => {
    const original = buildZip(MOD);
    const bytes = new Uint8Array(await original.arrayBuffer());
    const v = new DataView(bytes.buffer);
    const cdSize = v.getUint32(bytes.length - 22 + 12, true);
    const cdOffset = v.getUint32(bytes.length - 22 + 16, true);
    // Split the central directory into its records and reverse them.
    const records: Uint8Array[] = [];
    for (let c = cdOffset; c < cdOffset + cdSize; ) {
      const len = 46 + v.getUint16(c + 28, true) + v.getUint16(c + 30, true) + v.getUint16(c + 32, true);
      records.push(bytes.slice(c, c + len));
      c += len;
    }
    const reversed = new Blob([bytes.slice(0, cdOffset), ...records.reverse(), bytes.slice(cdOffset + cdSize)] as BlobPart[]);
    const after = await readZip(await stripTopFolder(reversed));
    expect(after.entries.map((e) => e.name)).toEqual(['STLs/a.stl', 'STLs/', 'README.md']);
    expect(after.entries.map((e) => e.data)).toEqual(['solid a\nendsolid a\n', '', '# Mod\n']);
  });
});

describe('isReadableZip', () => {
  const valid = () => buildZip([{ name: 'Mod/a.stl', data: 'solid a' }, { name: 'Mod/b.stl', data: 'solid b' }]);

  it('is true for a valid zip', async () => {
    expect(await isReadableZip(valid())).toBe(true);
  });

  it('is false for a zip cut off after some local headers (no central directory, no end record)', async () => {
    const whole = new Uint8Array(await valid().arrayBuffer());
    const cut = new Blob([whole.slice(0, 60)]);
    expect(await isReadableZip(cut)).toBe(false);
  });

  it('is false for random bytes and for nothing', async () => {
    expect(await isReadableZip(new Blob([new Uint8Array(500).map((_, i) => (i * 37 + 11) % 251)]))).toBe(false);
    expect(await isReadableZip(new Blob([]))).toBe(false);
  });
});
