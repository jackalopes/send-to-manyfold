/**
 * Maps a license name as shown on a source site to an SPDX id Manyfold accepts. Only clean matches map;
 * anything ambiguous (e.g. a Creative Commons license without a version) stays unmapped. The original text
 * is always kept in the notes by the caller, whether or not it maps.
 *
 * Manyfold 0.153.0 accepts any SPDX id (and `LicenseRef-*`) on `PATCH /models/{id}` and answers 422
 * "license is not a valid license" for anything else.
 */
export function mapLicense(text: string | undefined): { spdx?: string; keepOriginalInNotes: true } {
  const spdx = text ? (mapCreativeCommons(text) ?? mapOther(text)) : undefined;
  return spdx ? { spdx, keepOriginalInNotes: true } : { keepOriginalInNotes: true };
}

const CC_VERSIONS = new Set(['1.0', '2.0', '2.5', '3.0', '4.0']);
const CC_FILLER = new Set(['creative', 'commons', 'cc', 'international', 'universal', 'unported', 'generic', 'license', 'licence', 'deed', 'version', 'v']);

function mapCreativeCommons(text: string): string | undefined {
  const norm = text
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\bnon commercial\b/g, 'noncommercial')
    .replace(/\bshare alike\b/g, 'sharealike')
    .replace(/\bno deriv(?:ative)?s\b/g, 'noderivatives')
    .replace(/\bpublic domain dedication\b/g, 'cc0')
    .replace(/\bcc zero\b/g, 'cc0')
    .trim();
  const tokens = norm.split(' ').filter(Boolean);
  const isCc = tokens.includes('cc') || tokens.includes('cc0') || norm.includes('creative commons');
  if (!isCc) return undefined;

  let by = false;
  let nc = false;
  let sa = false;
  let nd = false;
  let zero = false;
  let version: string | undefined;
  for (const t of tokens) {
    if (t === 'by' || t === 'attribution') by = true;
    else if (t === 'nc' || t === 'noncommercial') nc = true;
    else if (t === 'sa' || t === 'sharealike') sa = true;
    else if (t === 'nd' || t === 'noderivatives' || t === 'noderivs') nd = true;
    else if (t === 'cc0') zero = true;
    else if (/^\d(?:\.\d)?$/.test(t)) version = t.includes('.') ? t : `${t}.0`;
    else if (!CC_FILLER.has(t)) return undefined; // unknown word: not a clean match
  }
  if (zero) return by || nc || sa || nd || (version && version !== '1.0') ? undefined : 'CC0-1.0';
  if (!by || (sa && nd) || !version || !CC_VERSIONS.has(version)) return undefined;
  return `CC-BY${nc ? '-NC' : ''}${sa ? '-SA' : ''}${nd ? '-ND' : ''}-${version}`;
}

/** Non-CC licenses: canonical SPDX ids (matched case-insensitively) and common display names. */
const OTHER: Record<string, string> = {};
for (const id of [
  'MIT',
  'Apache-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'MPL-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'Unlicense',
  'CERN-OHL-P-2.0',
  'CERN-OHL-S-2.0',
  'CERN-OHL-W-2.0',
]) {
  OTHER[key(id)] = id;
}
Object.assign(OTHER, {
  [key('MIT License')]: 'MIT',
  [key('The MIT License')]: 'MIT',
  [key('Apache License 2.0')]: 'Apache-2.0',
  [key('Apache 2.0')]: 'Apache-2.0',
  [key('GPL-2.0')]: 'GPL-2.0-only',
  [key('GPL-3.0')]: 'GPL-3.0-only',
  [key('GPLv2')]: 'GPL-2.0-only',
  [key('GPLv3')]: 'GPL-3.0-only',
  [key('GNU General Public License v2.0')]: 'GPL-2.0-only',
  [key('GNU General Public License v3.0')]: 'GPL-3.0-only',
  [key('LGPL-3.0')]: 'LGPL-3.0-only',
  [key('GNU Lesser General Public License v3.0')]: 'LGPL-3.0-only',
  [key('Mozilla Public License 2.0')]: 'MPL-2.0',
  [key('BSD 2-Clause')]: 'BSD-2-Clause',
  [key('BSD 3-Clause')]: 'BSD-3-Clause',
  [key('The Unlicense')]: 'Unlicense',
});

function mapOther(text: string): string | undefined {
  return OTHER[key(text)];
}

function key(s: string): string {
  return s.toLowerCase().replace(/[\s_]+/g, ' ').trim();
}
