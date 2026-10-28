import { ManyfoldClient } from './client';
import { listCollections, type NamedRef } from './metadata';

/** The collections of the Manyfold at `baseUrl`, for the settings page and the popup alike (default fetch and permission check). */
export const listCollectionsAt = (baseUrl: string, token: string): Promise<NamedRef[]> => listCollections(new ManyfoldClient(baseUrl, token));
