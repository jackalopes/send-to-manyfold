import type { Settings, TagMode } from '../settings';
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
  // Voron files are zipped together, so the image settings do not apply to them.
  const offered = model.files.filter((f) => f.bundle !== undefined || settings.includeImages || f.kind !== 'image');
  return {
    title: on.title ? model.title : '',
    description: on.description ? (model.description ?? '') : '',
    creatorName: on.creator ? (model.creator?.name ?? '') : '',
    licenseText: on.license ? (model.licenseText ?? '') : '',
    tags: model.site !== 'other' && settings.siteTags[model.site] === 'on' ? [...model.tags] : [],
    sourceLink: on.sourceUrl,
    files: offered.map((file) => {
      if (file.size !== undefined && file.size > MAX_FILE_BYTES) return { file, selected: false, disabledReason: TOO_LARGE };
      return { file, selected: file.kind === 'image' && file.bundle === undefined ? on.images : true };
    }),
    // A Voron send is one zip of the ticked files, so there is no loose-file model to hold a cover image.
    includeCover: settings.includeImages && !!model.coverImageUrl && !offered.some((f) => f.bundle !== undefined),
    collectionId: settings.defaultCollectionId?.trim() ?? '',
    sensitive: settings.defaultSensitive,
  };
}

export function parseTags(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];
}

/** What the popup suggests for the page's tags: add them, remove them for this send, or nothing. */
export function tagOffer(model: SourceModel, mode: TagMode, form: ReviewForm): 'add' | 'remove' | undefined {
  if (mode === 'off' || model.site === 'other' || model.tags.length === 0) return undefined;
  return model.tags.every((t) => form.tags.includes(t)) ? 'remove' : 'add';
}

/** Ticks or unticks the files at `indexes`; disabled files are never changed. */
export function setSelected(files: FormFile[], indexes: number[], selected: boolean): FormFile[] {
  return files.map((f, j) => (indexes.includes(j) && !f.disabledReason ? { ...f, selected } : f));
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
  delete source.licenseId;
  delete source.description;
  if (creatorName) source.creator = { name: creatorName, ...(model.creator?.url && creatorName === model.creator.name.trim() ? { url: model.creator.url } : {}) };
  if (licenseText) source.licenseText = licenseText;
  // The page's id belongs to the page's text: once the user edits the text, only name mapping of the edit applies.
  const licenseId = licenseText && model.licenseId && licenseText === model.licenseText?.trim() ? model.licenseId : undefined;
  if (description) source.description = description;
  const collection = form.collectionId.trim();
  return {
    source,
    selectedFiles: form.files.filter((f) => f.selected && !f.disabledReason).map((f) => f.file),
    title: form.title.trim(),
    ...(description ? { description } : {}),
    ...(licenseId ? { licenseId } : {}),
    collectionIds: collection ? [collection] : [],
    sensitive: form.sensitive,
    includeCover: form.includeCover,
    ...(form.sourceLink ? {} : { omitSourceLink: true }),
  };
}
