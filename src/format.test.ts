import { describe, expect, it } from 'vitest';
import { parseSize } from './adapters/voron';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('uses binary units, whole numbers without decimals and others with one', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(1500)).toBe('1.5 KiB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5 MiB');
    expect(formatBytes(1024 ** 3)).toBe('1 GiB');
    expect(formatBytes(1024 ** 4)).toBe('1 TiB');
    expect(formatBytes(2 * 1024 ** 5)).toBe('2048 TiB');
  });

  it('shows a decimal-unit size from a Voron page as binary units', () => {
    expect(formatBytes(parseSize('204 kB')!)).toBe('199.2 KiB');
  });
});
