// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlMarkdown } from './html-markdown';

const BASE = 'https://mods.vorondesign.com/details/X';

function md(html: string, base = BASE): string | undefined {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild!;
  return htmlMarkdown(root, base);
}

describe('htmlMarkdown', () => {
  it.each([1, 2, 3, 4, 5, 6])('renders h%i', (n) => {
    expect(md(`<h${n}>Title</h${n}>`)).toBe(`${'#'.repeat(n)} Title`);
  });

  it('separates paragraphs with a blank line', () => {
    expect(md('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });

  it('renders unordered, ordered and nested lists with two-space indents', () => {
    expect(md('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')).toBe('- a\n  - b\n- c');
    expect(md('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
  });

  it('resolves relative links against the base', () => {
    expect(md('<a href="/files/X/%2FSTL%2Fa.stl">a</a>')).toBe('[a](https://mods.vorondesign.com/files/X/%2FSTL%2Fa.stl)');
  });

  it('resolves relative images and keeps absolute ones', () => {
    expect(md('<img src="/i/1.png" alt="one">')).toBe('![one](https://mods.vorondesign.com/i/1.png)');
    const abs = 'https://raw.githubusercontent.com/VoronDesign/VoronUsers/main/a/1.jpg';
    expect(md(`<img src="${abs}" alt="">`)).toBe(`![](${abs})`);
  });

  it('renders strong, em and inline code', () => {
    expect(md('<p><strong>b</strong> <em>i</em> <code>c</code></p>')).toBe('**b** *i* `c`');
  });

  it('renders pre as a fenced block', () => {
    expect(md('<pre><code>a\nb</code></pre>')).toBe('```\na\nb\n```');
  });

  it('renders br as a line break', () => {
    expect(md('<p>a<br>b</p>')).toBe('a  \nb');
  });

  it('renders tables as one line per row, cells joined by " | "', () => {
    expect(md('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')).toBe('A | B\n1 | 2');
  });

  it('is undefined when blank', () => {
    expect(md('')).toBeUndefined();
    expect(md('<p> </p>')).toBeUndefined();
  });
});
