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
    box('Select STLs').click();
    expect(calls).toEqual([[[0, 1], true]]);
  });

  it('clicking an indeterminate folder selects all', () => {
    const calls = setup([ff('STLs/a.stl', true), ff('STLs/b.stl', false)]);
    box('Select STLs').click();
    expect(calls).toEqual([[[0, 1], true]]);
  });

  it("a partly ticked folder's checkbox is indeterminate", () => {
    setup([ff('STLs/a.stl', true), ff('STLs/b.stl', false)]);
    expect(box('Select STLs').indeterminate).toBe(true);
    expect(box('Select STLs').checked).toBe(false);
  });

  it('expand toggle has aria-expanded and a label naming the folder', () => {
    setup();
    const btn = root.querySelector<HTMLButtonElement>('button[aria-label="Expand STLs"]')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    return Promise.resolve().then(() => {
      expect(root.querySelector('button[aria-label="Collapse STLs"]')!.getAttribute('aria-expanded')).toBe('true');
      expect(root.textContent).toContain('b.stl');
    });
  });

  it('file rows show base name, kind and size', async () => {
    setup();
    root.querySelector<HTMLButtonElement>('button[aria-label="Expand STLs"]')!.click();
    await Promise.resolve();
    const row = [...root.querySelectorAll('li')].find((li) => li.textContent?.includes('b.stl'))!;
    expect(row.textContent).toContain('b.stl');
    expect(row.textContent).not.toContain('STLs/b.stl');
    expect(row.textContent).toContain('model');
    expect(row.textContent).toContain('1.0 kB');
  });

  it('unticking a fully ticked folder calls onSet with false', () => {
    const calls = setup([ff('STLs/a.stl', true), ff('STLs/b.stl', true)]);
    box('Select STLs').click();
    expect(calls).toEqual([[[0, 1], false]]);
  });

  it('a folder whose files are all disabled has a disabled checkbox', () => {
    const f = (p: string): FormFile => ({ ...ff(p, false), disabledReason: 'Too large' });
    setup([f('STLs/a.stl'), f('STLs/b.stl')]);
    expect(box('Select STLs').disabled).toBe(true);
  });

  it('clicking the folder name expands it without ticking', async () => {
    const calls = setup();
    root.querySelector<HTMLElement>('.tree-name')!.click();
    await Promise.resolve();
    expect(root.textContent).toContain('b.stl');
    expect(calls).toEqual([]);
  });

  it('labels nested folders by full path', async () => {
    setup([ff('A/V2/a.stl'), ff('B/V2/b.stl')]);
    root.querySelector<HTMLButtonElement>('button[aria-label="Expand A"]')!.click();
    await Promise.resolve();
    expect(box('Select A/V2')).toBeTruthy();
    expect(root.querySelector('button[aria-label="Expand A/V2"]')).toBeTruthy();
  });
});
