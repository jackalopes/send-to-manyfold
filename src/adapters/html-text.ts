const BLOCKS = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr';

/** Plain text of a description's HTML: one paragraph per block element, `&nbsp;` as spaces, empty blocks dropped. */
export function htmlText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  for (const br of body.querySelectorAll('br')) br.replaceWith('\n');
  for (const block of body.querySelectorAll(BLOCKS)) block.append('\n');
  const text = (body.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/[\s\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return text || undefined;
}
