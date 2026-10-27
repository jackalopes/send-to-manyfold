// Renders the master icon (assets/brand/icon.svg) to the extension's PNG sizes. Run: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, 'assets/brand/icon.svg');
const outDir = join(root, 'src/public/icon');
const SIZES = [16, 32, 48, 128];
// Chrome draws toolbar icons in a fixed 16/32 px slot, so those sizes get the artwork enlarged
// inside the background square (scaled about the artwork's own centre) to make it read a little bigger.
const TOOLBAR_SIZES = new Set([16, 32]);
const TOOLBAR_ART_SCALE = 1.08;

// Wraps everything after the background path (id="BG") up to the closing </g> in a scale transform.
const enlargeArt = (svg) => {
  const bgStart = svg.lastIndexOf('<path', svg.indexOf('id="BG"'));
  const groupEnd = svg.lastIndexOf('</g>');
  if (bgStart < 0 || groupEnd < bgStart) throw new Error('icon.svg: expected a path with id="BG" inside a <g>');
  const artStart = svg.indexOf('/>', bgStart) + 2;
  const art = svg.slice(artStart, groupEnd);
  const box = new Resvg(svg.slice(0, bgStart) + art + svg.slice(groupEnd)).innerBBox();
  if (!box) throw new Error('icon.svg: no artwork found after the BG path');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return `${svg.slice(0, artStart)}<g transform="translate(${cx} ${cy}) scale(${TOOLBAR_ART_SCALE}) translate(${-cx} ${-cy})">${art}</g>${svg.slice(groupEnd)}`;
};

const svg = readFileSync(source, 'utf8');
const toolbarSvg = enlargeArt(svg);
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const input = TOOLBAR_SIZES.has(size) ? toolbarSvg : svg;
  const png = new Resvg(input, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(outDir, `${size}.png`), png);
  console.log(`icon/${size}.png (${png.length} bytes)`);
}
