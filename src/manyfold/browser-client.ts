import { ManyfoldClient } from './client';
import { listCollections, type NamedRef } from './metadata';
import { fetchMaxUploadSize } from './upload';

/** The collections of the Manyfold at `baseUrl`, for the settings page and the popup alike (default fetch and permission check). */
export const listCollectionsAt = (baseUrl: string, token: string): Promise<NamedRef[]> => listCollections(new ManyfoldClient(baseUrl, token));

/** The upload limit (`Tus-Max-Size`) of the Manyfold at `baseUrl`, or undefined when it does not say or cannot be asked. Never rejects. */
export const maxUploadBytesAt = (baseUrl: string, token: string): Promise<number | undefined> => fetchMaxUploadSize(new ManyfoldClient(baseUrl, token)).catch(() => undefined);
