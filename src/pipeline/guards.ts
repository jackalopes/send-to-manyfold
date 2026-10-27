/** Small runtime type guards for data that arrives over chrome messaging (plain JSON, never trusted). */

export type Rec = Record<string, unknown>;

export const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isInt = (v: unknown): v is number => Number.isInteger(v);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

export const optional =
  <T>(guard: (v: unknown) => v is T) =>
  (v: unknown): v is T | undefined =>
    v === undefined || guard(v);

export const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    (values as readonly unknown[]).includes(v);

/** Every listed field of `r` passes its guard. */
export function hasShape(r: Rec, shape: Record<string, (v: unknown) => boolean>): boolean {
  return Object.entries(shape).every(([key, guard]) => guard(r[key]));
}
