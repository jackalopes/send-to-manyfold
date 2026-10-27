// Renders the master icon (assets/brand/icon.svg) to the extension's PNG sizes. Run: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, 'assets/brand/icon.svg');
const outDir = join(root, 'src/public/icon');
const SIZES = [16, 32, 48, 128];

const svg = readFileSync(source);
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(outDir, `${size}.png`), png);
  console.log(`icon/${size}.png (${png.length} bytes)`);
}
