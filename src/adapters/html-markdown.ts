/**
 * Markdown for an already-rendered HTML fragment (a site's README area), for a model's notes. Covers headings,
 * paragraphs, nested lists, links, images, strong/em, inline code, `pre`, `br` and tables (one line per row, cells
 * as GFM tables with the first row as header). Relative `href`/`src` become absolute against `baseUrl`. Unknown elements keep their text.
 * `imageWidth` appends a Kramdown attribute list (`{: width="N"}`) to each image. Undefined when nothing is left.
 */
const HEADING = /^H([1-6])$/;
const BLOCK = new Set(['P', 'DIV', 'UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HR']);

export function htmlMarkdown(root: Element, baseUrl: string, options: { imageWidth?: number } = {}): string | undefined {
  const abs = (value: string | null): string => {
    if (!value) return '';
    try {
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  };
  /** Only http(s) targets survive; anything else (javascript:, data:, …) is dropped. */
  const safe = (value: string | null): string => {
    const href = abs(value);
    return /^https?:\/\//i.test(href) ? href : '';
  };

  const inline = (node: Node): string => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ').replace(/[<>]/g, '\\$&');
    if (!(node instanceof Element)) return '';
    const inner = (): string => [...node.childNodes].map(inline).join('');
    switch (node.tagName) {
      case 'BR':
        return '  \n';
      case 'A': {
        const label = inner().trim();
        const href = safe(node.getAttribute('href'));
        return href && label ? `[${label}](${href})` : label;
      }
      case 'IMG': {
        const src = safe(node.getAttribute('src'));
        const alt = node.getAttribute('alt') ?? '';
        const width = options.imageWidth ? `{: width="${options.imageWidth}"}` : '';
        return src ? `![${alt}](${src})${width}` : alt;
      }
      case 'STRONG':
      case 'B':
        return wrap('**', inner());
      case 'EM':
      case 'I':
        return wrap('*', inner());
      case 'CODE':
        return wrap('`', node.textContent ?? '');
      default:
        return inner();
    }
  };

  const wrap = (mark: string, s: string): string => (s.trim() ? `${mark}${s.trim()}${mark}` : s);

  const list = (el: Element, depth: number): string[] => {
    const ordered = el.tagName === 'OL';
    const pad = '  '.repeat(depth);
    const lines: string[] = [];
    let n = 0;
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      n += 1;
      const nested: Element[] = [];
      let text = '';
      for (const child of li.childNodes) {
        if (child instanceof Element && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
        else text += inline(child);
      }
      lines.push(`${pad}${ordered ? `${n}.` : '-'} ${text.replace(/\s+/g, ' ').trim()}`);
      for (const sub of nested) lines.push(...list(sub, depth + 1));
    }
    return lines;
  };

  const table = (el: Element): string => {
    const rows = [...el.querySelectorAll('tr')]
      .map((tr) =>
        [...tr.children]
          .filter((c) => c.tagName === 'TH' || c.tagName === 'TD')
          .map((c) => inline(c).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')),
      )
      .filter((cells) => cells.some((c) => c));
    if (!rows.length) return '';
    const line = (cells: string[]): string => `| ${cells.join(' | ')} |`;
    return [line(rows[0]!), line(rows[0]!.map(() => '---')), ...rows.slice(1).map(line)].join('\n');
  };

  const blocks = (parent: Element): string[] => {
    const out: string[] = [];
    let run = '';
    const flush = (): void => {
      const text = run.replace(/\n +/g, '\n').trim();
      if (text) out.push(text);
      run = '';
    };
    for (const node of parent.childNodes) {
      if (!(node instanceof Element)) {
        run += inline(node);
        continue;
      }
      const tag = node.tagName;
      const heading = HEADING.exec(tag);
      if (heading) {
        flush();
        const text = inline(node).replace(/\s+/g, ' ').trim();
        if (text) out.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
      } else if (tag === 'UL' || tag === 'OL') {
        flush();
        out.push(...[list(node, 0).join('\n')].filter(Boolean));
      } else if (tag === 'PRE') {
        flush();
        const code = (node.textContent ?? '').replace(/\n+$/, '');
        if (code.trim()) {
          const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length));
          const fence = '`'.repeat(Math.max(3, longest + 1));
          out.push(`${fence}\n${code}\n${fence}`);
        }
      } else if (tag === 'TABLE') {
        flush();
        const t = table(node);
        if (t) out.push(t);
      } else if (tag === 'P') {
        flush();
        run = inline(node);
        flush();
      } else if (BLOCK.has(tag)) {
        flush();
        out.push(...blocks(node));
      } else {
        run += inline(node);
      }
    }
    flush();
    return out;
  };

  return blocks(root).join('\n\n') || undefined;
}
