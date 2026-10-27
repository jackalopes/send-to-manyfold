import { MESSAGES, type SendErrorCode } from '../pipeline/errors';
import type { ConnectionReply } from '../pipeline/messages';

export interface ConnectionSettings {
  manyfoldUrl: string;
  token: string;
}

/**
 * The Manyfold URL and token for a send, read from the saved settings in the background (the only context that
 * reads `chrome.storage`), after checking that the user still grants the host permission for that origin.
 */
export async function connectionFromSettings(load: () => Promise<ConnectionSettings>, hasPermission: (baseUrl: string) => Promise<boolean>): Promise<ConnectionReply> {
  let s: ConnectionSettings;
  try {
    s = await load();
  } catch {
    return fail('not-configured');
  }
  if (!s.manyfoldUrl || !s.token) return fail('not-configured');
  try {
    if (!(await hasPermission(s.manyfoldUrl))) return fail('no-permission');
  } catch {
    return fail('no-permission');
  }
  return { ok: true, baseUrl: s.manyfoldUrl, token: s.token };
}

function fail(code: SendErrorCode): ConnectionReply {
  return { ok: false, error: { code, message: MESSAGES[code], stage: 'downloading' } };
}
