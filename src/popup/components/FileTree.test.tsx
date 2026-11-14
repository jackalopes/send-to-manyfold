// @vitest-environment happy-dom
import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormFile } from '../state';
import { FileTree } from './FileTree';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => render(null, root));

const ff = (path: string, selected = true, size?: number): FormFile => ({
  file: { name: path.split('/').pop()!, path, url: `https://x/${path}`, kind: 'model', bundle: 'm.zip', ...(size !== undefined ? { size } : {}) },
  selected,
});
const files = [ff('readme.md'), ff('STLs/Front/a.stl', true, 2000), ff('STLs/b.stl', true, 1000)];

function setup(f: FormFile[] = files) {
  const calls: [number[], boolean][] = [];
  render(<FileTree files={f} onSet={(i, s) => void calls.push([i, s])} />, root);
  return calls;
}
const box = (label: string) => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

describe('FileTree', () => {
  it("top-level folders start collapsed and root files show", () => {
    setup();
    expect(root.textContent).toContain('readme.md');
    expect(root.textContent).toContain('STLs/');
    expect(root.textContent).not.toContain('b.stl');
  });

  it('ticking a folder calls onSet with all its files', () => {
    const calls = setup([ff('STLs/Front/a.stl', false), ff('STLs/b.stl', false)]);
    box('STLs').click();
    expect(calls).toEqual([[[0, 1], true]]);
  });

  it('clicking an indeterminate folder selects all', () => {
    const calls = setup([ff('STLs/a.stl', true), ff('STLs/b.stl', false)]);
    box('STLs').click();
    expect(calls).toEqual([[[0, 1], true]]);
  });

  it("a partly ticked folder's checkbox is indeterminate", () => {
    setup([ff('STLs/a.stl', true), ff('STLs/b.stl', false)]);
    expect(box('STLs').indeterminate).toBe(true);
    expect(box('STLs').checked).toBe(false);
  });

  it('expand toggle has aria-expanded and a label naming the folder', () => {
    setup();
    const btn = root.querySelector<HTMLButtonElement>('button[aria-label="STLs"]')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    return Promise.resolve().then(() => {
      expect(root.querySelector('button[aria-label="STLs"]')!.getAttribute('aria-expanded')).toBe('true');
      expect(root.textContent).toContain('b.stl');
    });
  });

  it('file rows show base name, kind and size', async () => {
    setup();
    root.querySelector<HTMLButtonElement>('button[aria-label="STLs"]')!.click();
    await Promise.resolve();
    const row = [...root.querySelectorAll('li')].find((li) => li.textContent?.includes('b.stl'))!;
    expect(row.textContent).toContain('b.stl');
    expect(row.textContent).not.toContain('STLs/b.stl');
    expect(row.textContent).toContain('model');
    expect(row.textContent).toContain('1000 B');
  });
});
