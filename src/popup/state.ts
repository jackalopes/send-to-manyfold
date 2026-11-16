import type { Settings, TagMode } from '../settings';
import { tooLargeReason, uploadLimit, type UploadLimit } from '../pipeline/files';
import type { SendRequest } from '../pipeline/types';
import type { SourceFile, SourceModel } from '../types';
import { isValidLicenseId, mapLicense } from '../manyfold/licenses';

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
  /** The upload limit the files were checked against (the server's once known); the 1 GiB default when absent. */
  limit?: UploadLimit;
}

/** Applies the per-field prefill toggles, the image settings, the default collection and the sensitive flag. */
export function buildInitialForm(model: SourceModel, settings: Settings, serverMax?: number): ReviewForm {
  const limit = uploadLimit(serverMax);
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
      if (file.size !== undefined && file.size > limit.bytes) return { file, selected: false, disabledReason: tooLargeReason(limit) };
      return { file, selected: file.kind === 'image' && file.bundle === undefined ? on.images : true };
    }),
    // A Voron send is one zip of the ticked files, so there is no loose-file model to hold a cover image.
    includeCover: settings.includeImages && !!model.coverImageUrl && !offered.some((f) => f.bundle !== undefined),
    collectionId: settings.defaultCollectionId?.trim() ?? '',
    sensitive: settings.defaultSensitive,
    limit,
  };
}

/** Applies a server limit learned after the form was built: files over it are unticked and disabled (with the reason for this limit); nothing else changes. */
export function applyServerLimit(form: ReviewForm, serverMax: number | undefined): ReviewForm {
  if (serverMax === undefined) return form;
  const limit = uploadLimit(serverMax);
  const reason = tooLargeReason(limit);
  const over = (f: FormFile) => f.file.size !== undefined && f.file.size > limit.bytes;
  const files = form.files.map((f) => (over(f) && (f.selected || f.disabledReason !== reason) ? { ...f, selected: false, disabledReason: reason } : f));
  const same = form.limit?.bytes === limit.bytes && form.limit.source === limit.source && files.every((f, i) => f === form.files[i]);
  return same ? form : { ...form, limit, files };
}

/** Bundles (one zip each) whose ticked parts already add up to more than the limit; unknown sizes count as 0, so the total is a lower bound. */
export function oversizeBundles(form: ReviewForm): { bundle: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const f of form.files) {
    if (f.file.bundle !== undefined && f.selected && !f.disabledReason) totals.set(f.file.bundle, (totals.get(f.file.bundle) ?? 0) + (f.file.size ?? 0));
  }
  const max = (form.limit ?? uploadLimit()).bytes;
  return [...totals].filter(([, total]) => total > max).map(([bundle, total]) => ({ bundle, total }));
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
  const licenseId = pageLicenseId(model, licenseText);
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

/** The page's license id, but only while the text is still the page's own text. Editing the text drops it. */
export function pageLicenseId(model: SourceModel, licenseText: string): string | undefined {
  const text = licenseText.trim();
  return text && model.licenseId && text === model.licenseText?.trim() ? model.licenseId : undefined;
}

/** True when the text is non-empty but will not set Manyfold's license field (same rule as the send), so it is saved in the notes only. */
export function licenseNotesOnly(model: SourceModel, licenseText: string): boolean {
  const text = licenseText.trim();
  if (!text) return false;
  const id = pageLicenseId(model, text)?.trim();
  if (id && isValidLicenseId(id)) return false;
  return !mapLicense(text).spdx;
}
