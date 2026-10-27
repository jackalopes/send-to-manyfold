import type { Settings } from '../settings';
import type { SendRequest } from '../pipeline/types';
import type { SourceFile, SourceModel } from '../types';

/** Manyfold's upload limit; larger files cannot be sent. */
export const MAX_FILE_BYTES = 1024 ** 3;

export interface FormFile {
  file: SourceFile;
  selected: boolean;
  /** Why the file cannot be sent; such a file is shown disabled and never selected. */
  disabledReason?: string;
}

/** The editable review form: everything the user can change before sending. */
export interface ReviewForm {
  title: string;
  description: string;
  creatorName: string;
  licenseText: string;
  tags: string[];
  /** False: the source URL is not saved as a link on the model (it is still used for the history). */
  sourceLink: boolean;
  files: FormFile[];
  includeCover: boolean;
  /** A Manyfold collection id, path or empty for none. */
  collectionId: string;
  sensitive: boolean;
}

const TOO_LARGE = 'Larger than 1 GiB, which Manyfold does not accept.';

/** Applies the per-field prefill toggles, the image settings, the default collection and the sensitive flag. */
export function buildInitialForm(model: SourceModel, settings: Settings): ReviewForm {
  const on = settings.prefill;
  const offered = model.files.filter((f) => settings.includeImages || f.kind !== 'image');
  return {
    title: on.title ? model.title : '',
    description: on.description ? (model.description ?? '') : '',
    creatorName: on.creator ? (model.creator?.name ?? '') : '',
    licenseText: on.license ? (model.licenseText ?? '') : '',
    tags: on.tags ? [...model.tags] : [],
    sourceLink: on.sourceUrl,
    files: offered.map((file) => {
      if (file.size !== undefined && file.size > MAX_FILE_BYTES) return { file, selected: false, disabledReason: TOO_LARGE };
      return { file, selected: file.kind === 'image' ? on.images : true };
    }),
    includeCover: settings.includeImages && !!model.coverImageUrl,
    collectionId: settings.defaultCollectionId?.trim() ?? '',
    sensitive: settings.defaultSensitive,
  };
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];
}

export function canSend(form: ReviewForm): boolean {
  return form.title.trim() !== '' && form.files.some((f) => f.selected && !f.disabledReason);
}

/** The request for the background: the page's model with the user's edits applied, and the selected files only. */
export function toSendRequest(model: SourceModel, form: ReviewForm): SendRequest {
  const creatorName = form.creatorName.trim();
  const licenseText = form.licenseText.trim();
  const description = form.description.trim();
  // Edits replace the page's values: a cleared field must not fall back to what the page had.
  const source: SourceModel = { ...model, tags: form.tags };
  delete source.creator;
  delete source.licenseText;
  delete source.description;
  if (creatorName) source.creator = { name: creatorName, ...(model.creator?.url && creatorName === model.creator.name.trim() ? { url: model.creator.url } : {}) };
  if (licenseText) source.licenseText = licenseText;
  if (description) source.description = description;
  const collection = form.collectionId.trim();
  return {
    source,
    selectedFiles: form.files.filter((f) => f.selected && !f.disabledReason).map((f) => f.file),
    title: form.title.trim(),
    ...(description ? { description } : {}),
    collectionIds: collection ? [collection] : [],
    sensitive: form.sensitive,
    includeCover: form.includeCover,
    ...(form.sourceLink ? {} : { omitSourceLink: true }),
  };
}
