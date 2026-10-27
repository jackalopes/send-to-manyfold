import { ManyfoldClient } from '../manyfold/client';
import { listCollections, type NamedRef } from '../manyfold/metadata';
import type { Settings } from '../settings';

type List = (baseUrl: string, token: string) => Promise<NamedRef[]>;

const realList: List = (baseUrl, token) => listCollections(new ManyfoldClient(baseUrl, token));

/** The collections for the default-collection picker, or undefined (the page then shows a text field) if they cannot be listed. */
export async function loadCollectionOptions(s: Settings, list: List = realList): Promise<NamedRef[] | undefined> {
  if (!s.manyfoldUrl || !s.token) return undefined;
  try {
    return await list(s.manyfoldUrl, s.token);
  } catch {
    return undefined;
  }
}
