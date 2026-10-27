import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../pipeline/errors';
import { errorText, failedFields, formatBytes, stageLabel } from './labels';

describe('errorText', () => {
  it('maps a code to its fixed message, never to raw text', () => {
    expect(errorText('upload-failed')).toBe(MESSAGES['upload-failed']);
    expect(errorText('not-configured')).toBe(MESSAGES['not-configured']);
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

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});
