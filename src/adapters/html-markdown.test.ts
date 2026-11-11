// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlMarkdown } from './html-markdown';

const BASE = 'https://mods.vorondesign.com/details/X';

function md(html: string, base = BASE, options?: { imageWidth?: number }): string | undefined {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild!;
  return htmlMarkdown(root, base, options);
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

  it('renders tables as GFM: header row, separator row, then rows', () => {
    expect(md('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('escapes | inside table cells', () => {
    expect(md('<table><tr><td>a|b</td><td>c</td></tr></table>')).toBe('| a\\|b | c |\n| --- | --- |');
  });

  it('keeps only http(s) link targets, otherwise the label alone', () => {
    expect(md('<p><a href="javascript:alert(1)">click</a></p>')).toBe('click');
    expect(md('<p><a href="/x">ok</a></p>')).toBe('[ok](https://mods.vorondesign.com/x)');
  });

  it('keeps only http(s) image sources, otherwise the alt text alone', () => {
    expect(md('<p><img src="data:image/png;base64,AAAA" alt="pic"></p>')).toBe('pic');
    expect(md('<p><img src="data:image/png;base64,AAAA"></p>')).toBeUndefined();
  });

  it('escapes literal < and > in plain text', () => {
    expect(md('<p>a &lt;script&gt;x&lt;/script&gt; b</p>')).toBe('a \\<script\\>x\\</script\\> b');
  });

  it('uses a longer fence when the code contains backticks', () => {
    expect(md('<pre>a\n```\nb</pre>')).toBe('````\na\n```\nb\n````');
  });

  it('is undefined when blank', () => {
    expect(md('')).toBeUndefined();
    expect(md('<p> </p>')).toBeUndefined();
  });

  describe('imageWidth option', () => {
    const opt = { imageWidth: 600 };
    it('adds a Kramdown width attribute to an image', () => {
      expect(md('<p><img src="/i/1.png" alt="one"></p>', BASE, opt)).toBe(
        '![one](https://mods.vorondesign.com/i/1.png){: width="600"}',
      );
    });
    it('adds it inside a link wrapper', () => {
      expect(md('<a href="/big"><img src="/i/1.png" alt="one"></a>', BASE, opt)).toBe(
        '[![one](https://mods.vorondesign.com/i/1.png){: width="600"}](https://mods.vorondesign.com/big)',
      );
    });
    it('leaves non-http images as alt text without the attribute', () => {
      expect(md('<p><img src="data:image/png;base64,AAAA" alt="pic"></p>', BASE, opt)).toBe('pic');
    });
    it('is unchanged without the option', () => {
      expect(md('<p><img src="/i/1.png" alt="one"></p>')).toBe('![one](https://mods.vorondesign.com/i/1.png)');
    });
  });
});
