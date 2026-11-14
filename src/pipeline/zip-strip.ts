/**
 * Removes the one top folder that every entry of a zip shares (Voron Mods zips put everything under
 * `<Title> by <author>/`), so Manyfold files them at the model root.
 *
 * Only the entry names in the local headers and the central directory are rewritten: every entry's compressed
 * data (and its data descriptor) is copied through untouched, so CRCs, sizes and the compression method stay valid.
 * Anything this does not fully understand (ZIP64, encryption, split archives, data before the first entry, offsets
 * that do not line up, malformed extra fields) leaves the zip as it was. It never throws: the unchanged zip still
 * uploads correctly, just with the folder.
 */

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_COMMENT = 0xffff;
/** Info-ZIP Unicode Path: repeats the entry name, so it would bring the old name back. */
const UNICODE_PATH_ID = 0x7075;
const SLASH = 0x2f;
const BACKSLASH = 0x5c;
const DOT = 0x2e;
/** General purpose flag bit 11: the name is UTF-8. */
const UTF8_FLAG = 0x0800;

interface Entry {
  /** The central directory record (fixed part only). */
  fixed: Uint8Array;
  name: Uint8Array;
  extra: Uint8Array;
  comment: Uint8Array;
  compressedSize: number;
  localOffset: number;
}

/** Why the zip is left as it was. Internal: caught in `stripTopFolder`. */
class Unchanged extends Error {}

const unchanged = (why: string): never => {
  throw new Unchanged(why);
};

/** A ZIP64 zip: not parsed here, but a valid zip. */
class Zip64 extends Unchanged {}

const zip64 = (): never => {
  throw new Zip64('ZIP64');
};

/**
 * Whether the blob has a zip end record and a central directory that lines up. A zip cut off mid-download (local
 * headers only) is not readable; so are encrypted and split zips, which also trigger the rebuild when parts exist.
 * ZIP64 zips count as readable: they are not parsed here, but Manyfold may unpack them.
 */
export async function isReadableZip(zip: Blob): Promise<boolean> {
  try {
    await readDirectory(zip);
    return true;
  } catch (e) {
    return e instanceof Zip64;
  }
}

export async function stripTopFolder(zip: Blob): Promise<Blob> {
  try {
    return await strip(zip);
  } catch {
    return zip;
  }
}

/** The end record and the central directory entries; throws `Unchanged` (`Zip64` for ZIP64) when they do not line up. */
async function readDirectory(zip: Blob): Promise<{ eocd: Uint8Array; eocdAt: number; cdOffset: number; entries: Entry[] }> {
  const { eocd, eocdAt } = await findEnd(zip);
  const ev = view(eocd);
  const count = ev.getUint16(10, true);
  const cdSize = ev.getUint32(12, true);
  const cdOffset = ev.getUint32(16, true);
  if (ev.getUint16(4, true) !== 0 || ev.getUint16(6, true) !== 0 || ev.getUint16(8, true) !== count) unchanged('split archive');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) zip64();
  if (cdOffset + cdSize !== eocdAt) unchanged('central directory does not end at the end record');
  if (eocdAt >= 20 && view(await bytes(zip, eocdAt - 20, eocdAt)).getUint32(0, true) === ZIP64_LOCATOR_SIG) zip64();
  return { eocd, eocdAt, cdOffset, entries: readCentral(await bytes(zip, cdOffset, eocdAt), count) };
}

async function strip(zip: Blob): Promise<Blob> {
  const { eocd, cdOffset, entries } = await readDirectory(zip);
  if (entries.length < 2) unchanged('single entry');

  const prefix = sharedTopFolder(entries.map((e) => e.name));
  const kept = entries.filter((e) => !sameBytes(e.name, prefix));
  if (!kept.length) unchanged('nothing but the folder');
  const newName = (e: Entry) => e.name.subarray(prefix.length);
  for (const e of kept) if (!safeName(newName(e))) unchanged('unsafe name after stripping');

  // Each entry's local region runs from its header to the next header (or the central directory): the data and
  // any data descriptor, copied as is.
  const byOffset = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  if (byOffset[0]!.localOffset !== 0) unchanged('data before the first entry');
  const regionEnd = new Map<Entry, number>();
  byOffset.forEach((e, i) => {
    const end = i + 1 < byOffset.length ? byOffset[i + 1]!.localOffset : cdOffset;
    if (end <= e.localOffset) unchanged('entries share an offset');
    regionEnd.set(e, end);
  });

  const parts: (Blob | Uint8Array)[] = [];
  const newOffset = new Map<Entry, number>();
  let at = 0;
  for (const e of byOffset) {
    const end = regionEnd.get(e)!;
    const fixed = await bytes(zip, e.localOffset, Math.min(end, e.localOffset + LOCAL_SIZE));
    const lv = view(fixed);
    if (fixed.length < LOCAL_SIZE || lv.getUint32(0, true) !== LOCAL_SIG) unchanged('no local header');
    if (lv.getUint16(6, true) & 1) unchanged('encrypted');
    const nameLen = lv.getUint16(26, true);
    const extraLen = lv.getUint16(28, true);
    const dataStart = e.localOffset + LOCAL_SIZE + nameLen + extraLen;
    if (dataStart + e.compressedSize > end) unchanged('entry data overruns the next entry');
    const nameAndExtra = await bytes(zip, e.localOffset + LOCAL_SIZE, dataStart);
    if (!sameBytes(nameAndExtra.subarray(0, nameLen), e.name)) unchanged('local and central names differ');
    if (sameBytes(e.name, prefix)) continue; // the folder entry itself
    const name = newName(e);
    const extra = withoutUnicodePath(nameAndExtra.subarray(nameLen), lv.getUint16(6, true));
    view(fixed).setUint16(26, name.length, true);
    view(fixed).setUint16(28, extra.length, true);
    newOffset.set(e, at);
    parts.push(fixed, name, extra, zip.slice(dataStart, end));
    at += LOCAL_SIZE + name.length + extra.length + (end - dataStart);
  }

  const newCdOffset = at;
  for (const e of kept) {
    const name = newName(e);
    const extra = withoutUnicodePath(e.extra, view(e.fixed).getUint16(8, true));
    const fixed = e.fixed.slice();
    const fv = view(fixed);
    fv.setUint16(28, name.length, true);
    fv.setUint16(30, extra.length, true);
    fv.setUint32(42, newOffset.get(e)!, true);
    parts.push(fixed, name, extra, e.comment);
    at += CENTRAL_SIZE + name.length + extra.length + e.comment.length;
  }

  const end = eocd.slice();
  const nv = view(end);
  nv.setUint16(8, kept.length, true);
  nv.setUint16(10, kept.length, true);
  nv.setUint32(12, at - newCdOffset, true);
  nv.setUint32(16, newCdOffset, true);
  parts.push(end);
  return new Blob(parts as BlobPart[], { type: zip.type });
}

/** The End of Central Directory record (with its comment): the last signature whose comment runs exactly to the end. */
async function findEnd(zip: Blob): Promise<{ eocd: Uint8Array; eocdAt: number }> {
  if (zip.size < EOCD_SIZE) unchanged('too small');
  const tailStart = Math.max(0, zip.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await bytes(zip, tailStart, zip.size);
  const tv = view(tail);
  for (let p = tail.length - EOCD_SIZE; p >= 0; p--) {
    if (tv.getUint32(p, true) === EOCD_SIG && p + EOCD_SIZE + tv.getUint16(p + 20, true) === tail.length) {
      return { eocd: tail.slice(p), eocdAt: tailStart + p };
    }
  }
  return unchanged('no end record');
}

function readCentral(cd: Uint8Array, count: number): Entry[] {
  const v = view(cd);
  const entries: Entry[] = [];
  let c = 0;
  for (let i = 0; i < count; i++) {
    if (c + CENTRAL_SIZE > cd.length || v.getUint32(c, true) !== CENTRAL_SIG) unchanged('bad central record');
    const flags = v.getUint16(c + 8, true);
    const compressedSize = v.getUint32(c + 20, true);
    const size = v.getUint32(c + 24, true);
    const nameLen = v.getUint16(c + 28, true);
    const extraLen = v.getUint16(c + 30, true);
    const commentLen = v.getUint16(c + 32, true);
    const disk = v.getUint16(c + 34, true);
    const localOffset = v.getUint32(c + 42, true);
    if (flags & 1) unchanged('encrypted');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || disk === 0xffff) zip64();
    if (disk !== 0) unchanged('split archive');
    const nameAt = c + CENTRAL_SIZE;
    const next = nameAt + nameLen + extraLen + commentLen;
    if (next > cd.length) unchanged('central record overruns');
    entries.push({
      fixed: cd.subarray(c, nameAt),
      name: cd.subarray(nameAt, nameAt + nameLen),
      extra: cd.subarray(nameAt + nameLen, nameAt + nameLen + extraLen),
      comment: cd.subarray(nameAt + nameLen + extraLen, next),
      compressedSize,
      localOffset,
    });
    c = next;
  }
  if (c !== cd.length) unchanged('central directory size mismatch');
  return entries;
}

/** `<folder>/` as bytes when every name starts with the same non-empty first segment; otherwise not stripped. */
function sharedTopFolder(names: Uint8Array[]): Uint8Array {
  const first = names[0]!;
  const slash = first.indexOf(SLASH);
  if (slash <= 0) unchanged('no top folder');
  const prefix = first.subarray(0, slash + 1);
  if (isDots(prefix.subarray(0, slash))) unchanged('dot folder');
  for (const n of names) if (!sameBytes(n.subarray(0, prefix.length), prefix)) unchanged('no shared top folder');
  return prefix;
}

/** Not empty, not absolute, not starting with a `.` segment, and no `..` segment anywhere (split on `/` and `\`). */
function safeName(name: Uint8Array): boolean {
  if (!name.length || name[0] === SLASH || name[0] === BACKSLASH) return false;
  const segments: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i <= name.length; i++) {
    if (i === name.length || name[i] === SLASH || name[i] === BACKSLASH) {
      segments.push(name.subarray(start, i));
      start = i + 1;
    }
  }
  if (isDots(segments[0]!)) return false;
  return !segments.some((seg) => seg.length === 2 && seg[0] === DOT && seg[1] === DOT);
}

const isDots = (segment: Uint8Array) => segment.length > 0 && segment.length <= 2 && segment.every((b) => b === DOT);

/**
 * The extra field records minus the Unicode Path one. Malformed records leave the zip unchanged, and so does a
 * Unicode Path field on a name without the UTF-8 flag: there the field holds the only readable name.
 */
function withoutUnicodePath(extra: Uint8Array, flags: number): Uint8Array {
  const v = view(extra);
  const keep: Uint8Array[] = [];
  let p = 0;
  while (p < extra.length) {
    if (p + 4 > extra.length) unchanged('malformed extra field');
    const end = p + 4 + v.getUint16(p + 2, true);
    if (end > extra.length) unchanged('malformed extra field');
    if (v.getUint16(p, true) !== UNICODE_PATH_ID) keep.push(extra.subarray(p, end));
    else if (!(flags & UTF8_FLAG)) unchanged('Unicode Path field on a non-UTF-8 name');
    p = end;
  }
  const out = new Uint8Array(keep.reduce((s, k) => s + k.length, 0));
  let at = 0;
  for (const k of keep) {
    out.set(k, at);
    at += k.length;
  }
  return out;
}

async function bytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
