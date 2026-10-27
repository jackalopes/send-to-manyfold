import { parseOffscreenRequest, type AckReply, type StatusReply } from '../pipeline/messages';
import type { SendSessions } from './sessions';

/**
 * Answers the background's requests in the offscreen document. Returns `undefined` for anything that is not a
 * valid offscreen request, so the listener stays silent (other extension contexts hear the same broadcasts).
 */
export function routeOffscreenMessage(raw: unknown, sessions: SendSessions): AckReply | StatusReply | undefined {
  const m = parseOffscreenRequest(raw);
  if (!m) return undefined;
  switch (m.type) {
    case 'start':
      return sessions.start(m.sendId, m.request, m.tabId);
    case 'retry':
      return sessions.retry(m.sendId, { ...(m.forceCreate !== undefined ? { forceCreate: m.forceCreate } : {}), ...(m.tabId !== undefined ? { tabId: m.tabId } : {}) });
    case 'cancel':
      return sessions.cancel(m.sendId);
    case 'discard':
      return sessions.discard(m.sendId);
    case 'status':
      return { ok: true, sends: sessions.status() };
  }
}

