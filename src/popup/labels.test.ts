import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../pipeline/errors';
import { errorText, failedFields, stageLabel } from './labels';

describe('errorText', () => {
  it('maps a code to its fixed message, never to raw text', () => {
    expect(errorText('upload-failed')).toBe(MESSAGES['upload-failed']);
    expect(errorText('not-configured')).toBe(MESSAGES['not-configured']);
  });
  it("shows the error's own specific message when present", () => {
    const m = 'Manyfold refused the upload of "x.stl" (HTTP 413).';
    expect(errorText('upload-failed', m)).toBe(m);
  });
  it('falls back to the code text for an empty message', () => {
    expect(errorText('upload-failed', '')).toBe(MESSAGES['upload-failed']);
    expect(errorText('SOMETHING_ELSE', '  ')).toBe(MESSAGES.unknown);
  });
  it('falls back to the generic message for an unknown code', () => {
    expect(errorText('SOMETHING_ELSE')).toBe(MESSAGES.unknown);
  });
});

describe('stageLabel', () => {
  it('has a label for every stage, including extracting', () => {
    expect(stageLabel('extracting')).toBe('Extracting…');
    for (const s of ['downloading', 'uploading', 'creating', 'extracting', 'metadata', 'done'] as const) expect(stageLabel(s)).not.toBe('');
  });
});

describe('failedFields', () => {
  it('lists field names for people and ignores the raw error text', () => {
    expect(failedFields([{ field: 'tags', error: 'secret?' }, { field: 'links', error: 'x' }, { field: 'weird', error: 'y' }])).toEqual(['Tags', 'Source link', 'weird']);
  });
});
