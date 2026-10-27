import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../pipeline/errors';
import { file } from '../pipeline/fakes';
import { resolveInTab } from './tab-resolve';

const f = file('a.stl', { url: undefined, ref: { id: '1' } });

describe('resolveInTab', () => {
  it('asks the source tab content script and passes its answer on', async () => {
    const toTab = vi.fn(async () => ({ ok: true, download: 'https://files.printables.com/a.stl' }));
    await expect(resolveInTab(toTab, 5, 'printables', f)).resolves.toEqual({ ok: true, download: 'https://files.printables.com/a.stl' });
    expect(toTab).toHaveBeenCalledWith(5, { to: 'content', type: 'resolveDownload', site: 'printables', file: f });
  });

  it('passes a download error from the page on unchanged', async () => {
    const error = { code: 'DOWNLOAD_BLOCKED', message: 'bot check for a.stl' };
    await expect(resolveInTab(async () => ({ ok: false, error }), 5, 'printables', f)).resolves.toEqual({ ok: false, error });
  });

  it('a closed tab -> source-tab-closed', async () => {
    const toTab = async () => Promise.reject(new Error('No tab with id: 5.'));
    await expect(resolveInTab(toTab, 5, 'printables', f)).resolves.toEqual({ ok: false, error: { code: 'source-tab-closed', message: MESSAGES['source-tab-closed'] } });
  });

  it.each([
    ['no content script (navigated away, or opened before install)', async () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))],
    ['a page that answered nothing', async () => undefined],
    ['a malformed answer', async () => ({ ok: true })],
  ])('%s -> source-tab-changed', async (_what, toTab) => {
    await expect(resolveInTab(toTab, 5, 'printables', f)).resolves.toEqual({ ok: false, error: { code: 'source-tab-changed', message: MESSAGES['source-tab-changed'] } });
  });
});
