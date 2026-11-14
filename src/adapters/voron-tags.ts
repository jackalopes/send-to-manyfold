/** The site's printer badges (detail pages spell them `V0.2`, `V1.8`, `V2.4`, `Switchwire`, `Trident`; cards use `V0`, `VT`, `VSW`) and the tag each one becomes. Unknown badges pass through unchanged. */
const BADGE_TAGS: Record<string, string> = {
  V0: 'Voron 0',
  'V0.2': 'Voron 0',
  'V1.8': 'Voron 1.8',
  'V2.4': 'Voron 2.4',
  VT: 'Voron Trident',
  VSW: 'Voron Switchwire',
  Switchwire: 'Voron Switchwire',
  Trident: 'Voron Trident',
};

/** Badge labels to tags, de-duplicated, in page order. */
export function voronTags(badges: string[]): string[] {
  const out: string[] = [];
  for (const badge of badges) {
    const tag = Object.hasOwn(BADGE_TAGS, badge) ? BADGE_TAGS[badge]! : badge;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}
