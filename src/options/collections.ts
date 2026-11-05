import { listCollectionsAt } from '../manyfold/browser-client';
import type { NamedRef } from '../manyfold/metadata';
import type { Settings } from '../settings';
import { collectionsFailureText } from '../ui/collections-failure';

type List = (baseUrl: string, token: string) => Promise<NamedRef[]>;

/**
 * The collections for the default-collection picker. If they cannot be listed there are no `options` (the page then
 * shows a text field) and `failure` says why; with nothing configured there is nothing to say.
 */
export async function loadCollectionOptions(s: Settings, list: List = listCollectionsAt): Promise<{ options?: NamedRef[]; failure?: string }> {
  if (!s.manyfoldUrl || !s.token) return {};
  try {
    return { options: await list(s.manyfoldUrl, s.token) };
  } catch (e) {
    return { failure: collectionsFailureText(e) };
  }
}
