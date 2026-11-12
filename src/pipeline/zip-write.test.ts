import { describe, expect, it } from 'vitest';
import { crc32, storedZip } from './zip-write';
import { isReadableZip } from './zip-strip';

const dec = new TextDecoder();
const blob = (s: string) => new Blob([s]);

/** A strict reader: every local header must agree with the central directory, and each entry's data with its CRC. */
async function read(zip: Blob) {
  const b = new Uint8Array(await zip.arrayBuffer());
  const v = new DataView(b.buffer);
  const p = b.length - 22;
  expect(v.getUint32(p, true)).toBe(0x06054b50);
  const count = v.getUint16(p + 10, true);
  expect(v.getUint16(p + 8, true)).toBe(count);
  expect(v.getUint32(p + 16, true) + v.getUint32(p + 12, true)).toBe(p);
  let c = v.getUint32(p + 16, true);
  const out: { name: string; text: string; flags: number; method: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(c, true)).toBe(0x02014b50);
    const nLen = v.getUint16(c + 28, true);
    const off = v.getUint32(c + 42, true);
    const size = v.getUint32(c + 24, true);
    expect(v.getUint32(c + 20, true)).toBe(size);
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    expect(v.getUint16(off + 6, true) & 8).toBe(0); // no data descriptor
    expect(v.getUint32(off + 18, true)).toBe(size);
    expect(v.getUint32(off + 22, true)).toBe(size);
    const lnLen = v.getUint16(off + 26, true);
    const data = b.slice(off + 30 + lnLen, off + 30 + lnLen + size);
    expect(crc32(data)).toBe(v.getUint32(c + 16, true));
    expect(v.getUint32(off + 14, true)).toBe(v.getUint32(c + 16, true));
    out.push({ name: dec.decode(b.slice(c + 46, c + 46 + nLen)), text: dec.decode(data), flags: v.getUint16(c + 8, true), method: v.getUint16(c + 10, true) });
    c += 46 + nLen + v.getUint16(c + 30, true) + v.getUint16(c + 32, true);
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('storedZip', () => {
  it('writes entries in folders that a reader (and isReadableZip) accepts, with names and bytes intact', async () => {
    const zip = await storedZip([
      { name: 'STL/a.stl', blob: blob('solid a') },
      { name: 'README.md', blob: blob('# Mod\n') },
    ]);
    expect(await isReadableZip(zip)).toBe(true);
    const entries = await read(zip);
    expect(entries.map((e) => [e.name, e.text])).toEqual([
      ['STL/a.stl', 'solid a'],
      ['README.md', '# Mod\n'],
    ]);
    expect(entries.every((e) => e.method === 0 && (e.flags & 0x0800) !== 0)).toBe(true);
  });

  it('keeps a non-ASCII name and an empty file', async () => {
    const zip = await storedZip([
      { name: 'Teile/Gehäuse_日本.stl', blob: blob('x') },
      { name: 'empty.txt', blob: new Blob([]) },
    ]);
    expect(await isReadableZip(zip)).toBe(true);
    expect((await read(zip)).map((e) => [e.name, e.text])).toEqual([
      ['Teile/Gehäuse_日本.stl', 'x'],
      ['empty.txt', ''],
    ]);
  });

  it('refuses more entries than a plain zip can count', async () => {
    const same = new Blob([]);
    const many = Array.from({ length: 65_535 }, (_, i) => ({ name: `f${i}`, blob: same }));
    await expect(storedZip(many)).rejects.toThrow(/ZIP64/);
  });
});
