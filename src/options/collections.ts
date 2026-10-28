import { listCollectionsAt } from '../manyfold/browser-client';
import type { NamedRef } from '../manyfold/metadata';
import type { Settings } from '../settings';

type List = (baseUrl: string, token: string) => Promise<NamedRef[]>;

/** The collections for the default-collection picker, or undefined (the page then shows a text field) if they cannot be listed. */
export async function loadCollectionOptions(s: Settings, list: List = listCollectionsAt): Promise<NamedRef[] | undefined> {
  if (!s.manyfoldUrl || !s.token) return undefined;
  try {
    return await list(s.manyfoldUrl, s.token);
  } catch {
    return undefined;
  }
}
