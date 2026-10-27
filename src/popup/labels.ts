import { MESSAGES, type SendErrorCode } from '../pipeline/errors';
import type { SendStage } from '../pipeline/types';

/**
 * User-facing text for an error: the pipeline's own message when there is one (it is fixed text plus file names,
 * never raw exception text), else the fixed text for the code.
 */
export function errorText(code: string, message?: string): string {
  if (message?.trim()) return message;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code as SendErrorCode] : MESSAGES.unknown;
}

const STAGES: Record<SendStage, string> = {
  downloading: 'Downloading from the site…',
  uploading: 'Uploading to Manyfold…',
  creating: 'Creating the model…',
  extracting: 'Extracting…',
  metadata: 'Saving details…',
  done: 'Done',
};

export const stageLabel = (stage: SendStage): string => STAGES[stage];

const FIELDS: Record<string, string> = {
  name: 'Title',
  caption: 'Caption',
  notes: 'Description',
  links: 'Source link',
  license: 'License',
  creator: 'Creator',
  collections: 'Collections',
  tags: 'Tags',
  sensitive: 'Sensitive flag',
  preview: 'Preview image',
};

/** Human names of the metadata fields that did not save. */
export function failedFields(failed: { field: string; error: string }[]): string[] {
  return failed.map((f) => FIELDS[f.field] ?? f.field);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}
