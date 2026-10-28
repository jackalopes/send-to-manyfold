/**
 * Opt-in, read-only test against a real Manyfold (>= 0.147.0). Excluded from `npm test` (vitest.config.ts) unless
 * MANYFOLD_LIVE_URL is set, and skipped without MANYFOLD_LIVE_TOKEN. It writes nothing.
 *   MANYFOLD_LIVE_URL=http://127.0.0.1:3214 MANYFOLD_LIVE_TOKEN=... npx vitest run src/manyfold/lookup.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { ManyfoldClient } from './client';
import { lookupModel } from './lookup';

const url = process.env.MANYFOLD_LIVE_URL;
const token = process.env.MANYFOLD_LIVE_TOKEN;

describe.skipIf(!url || !token)('lookupModel (live)', () => {
  it('answers for a model page that is surely not saved, without throwing', async () => {
    const client = new ManyfoldClient(url!, token!, undefined, async () => true);
    const r = await lookupModel(client, 'https://makerworld.com/en/models/999999999-not-a-real-model');
    // 'none' on a server with the link filter; 'too-many' on one that ignores it.
    expect(['none', 'unknown']).toContain(r.status);
  });
});
