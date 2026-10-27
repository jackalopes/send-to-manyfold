/** A finished Tus upload, ready to be referenced from `POST /models`. */
export interface UploadedFile {
  /** Absolute Tus upload URL (the `Location` from `POST /upload`). Sent as `files[].id`. */
  id: string;
  /** Original filename including extension; Manyfold uses the extension to detect archives. */
  name: string;
  size: number;
}

/** A file inside a Manyfold model, as listed in `hasPart` of `GET /models/{id}`. */
export interface ModelFile {
  /** Absolute `@id` URL of the model file (usable as `preview_file.@id` in a PATCH). */
  id: string;
  /** Humanised display name (e.g. "Part" for `part.stl`), not the filename. */
  name: string;
  /** MIME type, e.g. `model/stl`, `image/png`, `application/zip`. */
  encodingFormat?: string;
}

export type CreatedModel = { status: 'created'; id: string; url: string } | { status: 'accepted-no-location' };
