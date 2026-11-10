import { describe, it, expect, vi } from 'vitest';
import { connectionLevel, describeResult, runConnectionCheck, runConnectionTest } from './connection-test';

describe('runConnectionTest', () => {
  it('invalid URL: no permission request, no test', async () => {
    const deps = { requestPermission: vi.fn(), test: vi.fn() };
    expect(await runConnectionTest('http:///x', 't', deps)).toMatch(/valid Manyfold URL/);
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.test).not.toHaveBeenCalled();
  });
  it('denied: says so and does not test', async () => {
    const deps = { requestPermission: vi.fn(async () => false), test: vi.fn() };
    expect(await runConnectionTest('m.local:3214', 't', deps)).toMatch(/permission.*denied/i);
    expect(deps.requestPermission).toHaveBeenCalledWith('http://m.local:3214');
    expect(deps.test).not.toHaveBeenCalled();
  });
  it('granted: tests the normalized URL and describes the result', async () => {
    const deps = { requestPermission: vi.fn(async () => true), test: vi.fn(async () => ({ ok: true as const, version: '0.153.0' })) };
    expect(await runConnectionTest('m.local:3214/', 'tok', deps)).toBe('Connected to Manyfold 0.153.0.');
    expect(deps.test).toHaveBeenCalledWith('http://m.local:3214', 'tok');
  });
  it('requests permission before any other await', async () => {
    const order: string[] = [];
    const deps = {
      requestPermission: vi.fn(() => { order.push('perm'); return Promise.resolve(true); }),
      test: vi.fn(async () => { order.push('test'); return { ok: true as const, version: 'unknown' }; }),
    };
    const p = runConnectionTest('m.local', 't', deps);
    expect(order).toEqual(['perm']);
    await p;
  });
});

describe('runConnectionCheck without a token', () => {
  it.each(['', '   '])('asks for the token (%j) without a permission prompt or a request', async (token) => {
    const deps = { requestPermission: vi.fn(), test: vi.fn() };
    expect(await runConnectionCheck('m.local', token, deps)).toEqual({ message: 'Enter your API token first.', level: 'error', connected: false });
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.test).not.toHaveBeenCalled();
  });
  it('trims the token it tests with', async () => {
    const deps = { requestPermission: vi.fn(async () => true), test: vi.fn(async () => ({ ok: true as const, version: 'unknown' })) };
    await runConnectionCheck('m.local', ' tok\n', deps);
    expect(deps.test).toHaveBeenCalledWith('http://m.local', 'tok');
  });
});

describe('connectionLevel', () => {
  it('is a warning for a connection that worked but came with a detail, ok without, error for a failure', () => {
    expect(connectionLevel({ ok: true, version: '0.153.0' })).toBe('ok');
    expect(connectionLevel({ ok: true, version: '0.153.0', detail: 'Could not check the upload scope.' })).toBe('warning');
    expect(connectionLevel({ ok: false, reason: 'unauthorized' })).toBe('error');
  });
});

describe('runConnectionCheck', () => {
  it('returns the message with its level', async () => {
    const deps = { requestPermission: async () => true, test: async () => ({ ok: true as const, version: '1.0.0', detail: 'Heads up.' }) };
    expect(await runConnectionCheck('m.local', 't', deps)).toEqual({ message: 'Connected to Manyfold 1.0.0. Heads up.', level: 'warning', connected: true });
    expect(await runConnectionCheck('http:///x', 't', deps)).toMatchObject({ level: 'error', connected: false });
  });
});

describe('describeResult', () => {
  it('a revoked site permission keeps its text', () => {
    expect(describeResult({ ok: false, reason: 'no-permission', detail: 'Permission to access this Manyfold server was revoked. Save settings again to re-grant it.' })).toBe(
      'Could not connect: Permission to access this Manyfold server was revoked. Save settings again to re-grant it.',
    );
  });
  it('says just "Connected." when the version is unknown', () => {
    expect(describeResult({ ok: true, version: 'unknown' })).toBe('Connected.');
  });
  it('names the version when known, and appends a detail', () => {
    expect(describeResult({ ok: true, version: '0.153.0' })).toBe('Connected to Manyfold 0.153.0.');
    expect(describeResult({ ok: true, version: 'unknown', detail: 'Heads up.' })).toBe('Connected. Heads up.');
  });
  it('keeps the error labels', () => {
    expect(describeResult({ ok: false, reason: 'unauthorized' })).toBe('Token rejected');
  });
});

describe('runConnectionCheck with a permission already held', () => {
  it('does not request permission again', async () => {
    const deps = { hasPermission: vi.fn(async () => true), requestPermission: vi.fn(async () => true), test: vi.fn(async () => ({ ok: true as const, version: '0.153.0' })) };
    const r = await runConnectionCheck('http://m.local:3214', 'tok', deps);
    expect(deps.hasPermission).toHaveBeenCalledWith('http://m.local:3214');
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(r.connected).toBe(true);
  });

  it('requests permission when it is not held', async () => {
    const deps = { hasPermission: vi.fn(async () => false), requestPermission: vi.fn(async () => true), test: vi.fn(async () => ({ ok: true as const, version: '0.153.0' })) };
    await runConnectionCheck('http://m.local:3214', 'tok', deps);
    expect(deps.requestPermission).toHaveBeenCalledWith('http://m.local:3214');
  });

  it('still reports a denied request', async () => {
    const deps = { hasPermission: vi.fn(async () => false), requestPermission: vi.fn(async () => false), test: vi.fn() };
    const r = await runConnectionCheck('http://m.local:3214', 'tok', deps);
    expect(r.connected).toBe(false);
    expect(deps.test).not.toHaveBeenCalled();
  });
});
