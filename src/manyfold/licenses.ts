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

/** An SPDX id or a `LicenseRef-` id: letters, digits, `.` and `-` only (the SPDX idstring), with something after `LicenseRef-`. */
export function isValidLicenseId(id: string): boolean {
  return /^(?!LicenseRef-$)[A-Za-z0-9][A-Za-z0-9.-]*$/.test(id);
}

/**
 * SPDX id for a Creative Commons deed link (`creativecommons.org/licenses/<by...>/<version>/`, also `/legalcode`
 * and `/deed.xx`, or `/publicdomain/zero/1.0/`). Scheme, case, `www.`, trailing slash, query and fragment do not
 * matter; the version is read from the link. Anything else stays unmapped.
 */
export function spdxFromLicenseUrl(url: string | undefined): string | undefined {
  const m = /^https?:\/\/(?:www\.)?creativecommons\.org\/(.*?)\/?(?:[?#].*)?$/i.exec(url?.trim() ?? '');
  const path = m?.[1]?.toLowerCase();
  if (!path) return undefined;
  if (/^publicdomain\/zero\/1\.0(?:\/.*)?$/.test(path)) return 'CC0-1.0';
  const lic = /^licenses\/(by(?:-nc)?(?:-sa|-nd)?)\/(\d\.\d)(?:\/(?:legalcode|deed(?:\.[\w-]+)?)?)?$/.exec(path);
  if (!lic || !CC_VERSIONS.has(lic[2]!)) return undefined;
  return `CC-${lic[1]!.toUpperCase()}-${lic[2]}`;
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
  // Voron Mods writes the license without the "GNU".
  [key('General Public License v2.0')]: 'GPL-2.0-only',
  [key('General Public License v3.0')]: 'GPL-3.0-only',
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
